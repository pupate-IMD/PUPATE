"use client";

// The miner as the page sees it: start and stop, power and engine, the live rate and the sample digest
// for the drawing, the hashes found, and the field log. Two engines grind the same kind of job: the CPU,
// a pool of Web Workers (one per spare core), and the GPU, one WebGPU dispatch loop (gpu/gpuMiner.ts)
// whose hits are re-hashed on the CPU before they count. The GPU is offered when the browser has WebGPU
// and an adapter; the first time it is picked it runs a self-test, and its practice target follows the
// rate that test measured. A GPU that is lost or fails puts the miner back on the CPU by itself.
// Live mode (jobs from the contract, auto-mint through the wallet) plugs into the same hook when the
// contracts exist; today every run is a practice run, and a found hash is logged, never minted.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Hex } from "viem";
import { type GpuFailure, GpuMiner } from "./gpu/gpuMiner";
import { type Engine, type FromWorker, type MinerJob, type Power, PRACTICE_BITS, fmtRate, leadingZeroBits, practiceBitsFor, practiceJob, randomHex } from "./job";

export interface Found {
  n: number;
  nonce: Hex;
  digest: Hex;
  /// Four more leading zero bits than the target asks: a gilt hash, one in sixteen.
  gilt: boolean;
  at: number;
  sinceStart: number;
  minted: boolean;
}

export interface LogLine {
  at: string;
  text: string;
  tone?: "jade" | "gold" | "dim";
}

export interface GpuSelfTestState {
  running: boolean;
  ok: boolean;
  /// Hashes per second over the self-test's one second of work.
  rate: number;
  /// Hashes per dispatch the batch settled at.
  batch: number;
  detail: string;
}

export interface GpuState {
  /// The probe has answered; until then the GPU option waits.
  checked: boolean;
  available: boolean;
  /// The adapter, as the browser names it.
  name?: string;
  /// Why the GPU is unavailable.
  reason?: string;
  selfTest?: GpuSelfTestState;
}

export interface MinerState {
  running: boolean;
  practice: boolean;
  engine: Engine;
  power: Power;
  threads: number;
  auto: boolean;
  rate: number;
  hashes: number;
  seconds: number;
  sample: Hex | null;
  found: Found[];
  /// A found hash waiting for the Mint button (auto-mint off).
  pending: Found | null;
  log: LogLine[];
  /// The practice target of the engine in use, in leading zero bits.
  bits: number;
  gpu: GpuState;
}

const CHUNK = 2000;

function stamp(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function useMiner() {
  const [engine, setEngineState] = useState<Engine>("cpu");
  const [power, setPowerState] = useState<Power>(75);
  const [auto, setAuto] = useState(true);
  const [running, setRunning] = useState(false);
  const [practice, setPractice] = useState(true);
  const [rate, setRate] = useState(0);
  const [hashes, setHashes] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [sample, setSample] = useState<Hex | null>(null);
  const [found, setFound] = useState<Found[]>([]);
  const [pending, setPendingState] = useState<Found | null>(null);
  // The log starts empty on the server and gets its first line on the client, so the time stamp never
  // differs between the two renders.
  const [log, setLog] = useState<LogLine[]>([]);
  const [threads, setThreads] = useState(1);
  const [bits, setBits] = useState(PRACTICE_BITS);
  const [gpu, setGpuState] = useState<GpuState>({ checked: false, available: false });

  const workers = useRef<Worker[]>([]);
  const gpuMiner = useRef<GpuMiner | null>(null);
  /// Hashes per CPU worker; the GPU counts in slot 0.
  const counts = useRef<number[]>([]);
  const t0 = useRef(0);
  const job = useRef<MinerJob | null>(null);
  const timer = useRef<number | null>(null);
  const foundN = useRef(0);
  const sampledAt = useRef(0);
  // What callbacks that outlive a render (worker and GPU messages, the self-test) read at call time.
  const autoRef = useRef(auto);
  autoRef.current = auto;
  const engineRef = useRef<Engine>("cpu");
  const powerRef = useRef<Power>(75);
  const threadsRef = useRef(1);
  const runningRef = useRef(false);
  const pendingRef = useRef<Found | null>(null);
  const gpuRef = useRef<GpuState>(gpu);
  const gpuBits = useRef(PRACTICE_BITS);
  /// The engine the visitor asked for last; a self-test that ends after they went back to the CPU stays put.
  const wanted = useRef<Engine>("cpu");
  // dispatch and the found handler call each other, and the GPU's failure handler switches engines.
  const dispatchRef = useRef<(j: MinerJob) => void>(() => {});
  const switchRef = useRef<(e: Engine) => void>(() => {});

  const engineBits = () => (engineRef.current === "gpu" ? gpuBits.current : PRACTICE_BITS);
  const engineText = (e: Engine) =>
    e === "gpu" ? `GPU · ${gpuRef.current.name ?? "WebGPU"}` : `CPU, ${threadsRef.current} thread${threadsRef.current > 1 ? "s" : ""}`;

  const setGpu = useCallback((f: (g: GpuState) => GpuState) => {
    gpuRef.current = f(gpuRef.current);
    setGpuState(gpuRef.current);
  }, []);

  const setPending = useCallback((f: Found | null) => {
    pendingRef.current = f;
    setPendingState(f);
  }, []);

  /// The drawing redraws at most ten times a second, so the sample needs no more; every extra update is a
  /// render of the bench, on the main thread the GPU's dispatch loop runs on.
  const showSample = useCallback((hex: Hex) => {
    const now = performance.now();
    if (now - sampledAt.current < 100) return;
    sampledAt.current = now;
    setSample(hex);
  }, []);

  const say = useCallback((text: string, tone?: LogLine["tone"]) => {
    setLog((l) => [{ at: stamp(), text, tone }, ...l].slice(0, 40));
  }, []);

  const dropWorkers = useCallback(() => {
    for (const w of workers.current) {
      w.postMessage({ type: "stop" });
      w.terminate();
    }
    workers.current = [];
  }, []);

  /// Stops both engines and the rate timer.
  const terminate = useCallback(() => {
    dropWorkers();
    gpuMiner.current?.stop();
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
  }, [dropWorkers]);

  const onFound = useCallback(
    (jobId: number, nonce: Hex, digest: Hex) => {
      const j = job.current;
      if (!j || jobId !== j.id || pendingRef.current) return;
      const f: Found = {
        n: ++foundN.current,
        nonce,
        digest,
        gilt: leadingZeroBits(digest) >= j.bits + 4,
        at: Date.now(),
        sinceStart: (performance.now() - t0.current) / 1000,
        minted: false,
      };
      if (autoRef.current) {
        f.minted = true;
        setFound((list) => [f, ...list]);
        say(f.gilt ? `valid hash, a gilt one · practice mint · mining the next one` : `valid hash found · practice mint · mining the next one`, f.gilt ? "gold" : "jade");
        // A real mint changes prevWork for everyone; a practice mint changes the folded word the same way.
        dispatchRef.current(practiceJob(j.id + 1, j.miner, engineBits()));
      } else {
        setFound((list) => [f, ...list]);
        setPending(f);
        say(f.gilt ? `valid hash found, a gilt one · mint it now` : `valid hash found · mint it now`, f.gilt ? "gold" : "jade");
        for (const w of workers.current) w.postMessage({ type: "stop" });
        gpuMiner.current?.stop();
      }
    },
    // engineBits reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [say, setPending],
  );

  const onWorker = useCallback(
    (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      if (!job.current || m.jobId !== job.current.id) return;
      if (m.type === "progress") {
        counts.current[m.worker] = (counts.current[m.worker] || 0) + m.hashes;
        if (m.sample !== "0x") showSample(m.sample);
        return;
      }
      onFound(m.jobId, m.nonce, m.digest);
    },
    [onFound, showSample],
  );

  /// The GPU stopped itself. Hits that failed the CPU check mark it as failed; a lost or failing device
  /// gets a fresh self-test the next time it is picked. Either way the miner goes back to the CPU.
  const onGpuFail = useCallback(
    (reason: string, kind: GpuFailure) => {
      setGpu((g) => ({
        ...g,
        selfTest: kind === "verify" ? { running: false, ok: false, rate: g.selfTest?.rate ?? 0, batch: g.selfTest?.batch ?? 0, detail: reason } : undefined,
      }));
      if (engineRef.current !== "gpu") return;
      say(`${reason} · back on the CPU`, "dim");
      wanted.current = "cpu";
      switchRef.current("cpu");
    },
    [say, setGpu],
  );

  const dispatch = useCallback(
    (j: MinerJob) => {
      job.current = j;
      counts.current = [];
      t0.current = performance.now();
      setHashes(0);
      setRate(0);
      setBits(j.bits);
      if (engineRef.current === "gpu") {
        dropWorkers();
        const g = (gpuMiner.current ??= new GpuMiner());
        g.start(j, {
          power: powerRef.current,
          onProgress: (p) => {
            if (job.current?.id !== p.jobId) return;
            counts.current[0] = (counts.current[0] || 0) + p.hashes;
            showSample(p.sample);
          },
          onFound: (h) => onFound(h.jobId, h.nonce, h.digest),
          onLog: (text) => say(text, "dim"),
          onFail: onGpuFail,
        });
        return;
      }
      gpuMiner.current?.stop();
      if (!workers.current.length) {
        workers.current = Array.from({ length: threadsRef.current }, () => {
          const w = new Worker(new URL("./miner.worker.ts", import.meta.url), { type: "module" });
          w.onmessage = onWorker;
          return w;
        });
      }
      workers.current.forEach((w, i) => w.postMessage({ type: "start", job: j, nonceHigh: randomHex(32), power: powerRef.current, worker: i, chunk: CHUNK }));
    },
    [dropWorkers, onFound, onGpuFail, onWorker, say, showSample],
  );
  dispatchRef.current = dispatch;

  const start = useCallback(
    (opts: { miner?: Hex } = {}) => {
      terminate();
      setPractice(true);
      setPending(null);
      dispatch(practiceJob(1, opts.miner, engineBits()));
      runningRef.current = true;
      setRunning(true);
      const n = threadsRef.current;
      const where = engineRef.current === "gpu" ? `${gpuRef.current.name ?? "WebGPU"}` : `${n} thread${n > 1 ? "s" : ""}`;
      say(`started on ${engineRef.current.toUpperCase()} at ${powerRef.current}% power · ${where} · practice job, real speed`);
      timer.current = window.setInterval(() => {
        const total = counts.current.reduce((a, b) => a + b, 0);
        const s = (performance.now() - t0.current) / 1000;
        setHashes(total);
        setSeconds(s);
        setRate(s > 0.5 ? total / s : 0);
      }, 500);
    },
    // engineBits and engineText read refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dispatch, say, setPending, terminate],
  );

  const stop = useCallback(() => {
    if (!runningRef.current) return;
    terminate();
    runningRef.current = false;
    setRunning(false);
    say("stopped");
  }, [say, terminate]);

  /// The Mint button in a practice run: nothing is sent; the log says what a live mint would do.
  const mintPending = useCallback(() => {
    const f = pendingRef.current;
    if (!f || !job.current) return;
    setFound((list) => list.map((x) => (x.n === f.n ? { ...x, minted: true } : x)));
    setPending(null);
    say("practice mint · live, your wallet would open to sign here", "dim");
    if (runningRef.current) dispatch(practiceJob(job.current.id + 1, job.current.miner, engineBits()));
    // engineBits reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, say, setPending]);

  const setPower = useCallback((p: Power) => {
    powerRef.current = p;
    setPowerState(p);
    for (const w of workers.current) w.postMessage({ type: "power", power: p });
    gpuMiner.current?.setPower(p);
  }, []);

  /// Puts the miner on engine `e`; a running miner moves its search there with a fresh job.
  const switchTo = useCallback(
    (e: Engine) => {
      engineRef.current = e;
      setEngineState(e);
      const b = engineBits();
      say(`engine: ${engineText(e)} · practice target ${b} bits`);
      if (runningRef.current && !pendingRef.current && job.current) dispatch(practiceJob(job.current.id + 1, job.current.miner, b));
      else setBits(b);
    },
    // engineBits and engineText read refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dispatch, say],
  );
  switchRef.current = switchTo;

  /// The engine switch. The GPU runs its self-test the first time it is picked, and is used only if it passes.
  const setEngine = useCallback(
    async (e: Engine) => {
      wanted.current = e;
      if (e === engineRef.current) return;
      if (e === "cpu") return switchTo("cpu");
      const g = gpuRef.current;
      if (!g.available || g.selfTest?.running || (g.selfTest && !g.selfTest.ok)) return;
      if (!g.selfTest) {
        setGpu((s) => ({ ...s, selfTest: { running: true, ok: false, rate: 0, batch: 0, detail: "" } }));
        say("GPU self-test: a known hash, 256 hits checked on the CPU, one second of work", "dim");
        const r = await GpuMiner.selfTest();
        setGpu((s) => ({ ...s, name: r.name || s.name, selfTest: { running: false, ok: r.ok, rate: r.rate, batch: r.batch, detail: r.detail } }));
        if (!r.ok) {
          say(`GPU self-test failed: ${r.detail}`);
          return;
        }
        gpuBits.current = practiceBitsFor(r.rate);
        say(`GPU self-test passed · ${fmtRate(r.rate)} · ${r.batch.toLocaleString("en-US")} hashes a batch`, "jade");
        if (wanted.current !== "gpu") return;
      }
      switchTo("gpu");
    },
    [say, setGpu, switchTo],
  );

  useEffect(() => {
    const n = Math.max(1, (navigator.hardwareConcurrency || 4) - 1);
    threadsRef.current = n;
    setThreads(n);
    setLog([{ at: stamp(), text: "ready" }]);
    let live = true;
    void GpuMiner.probe().then((p) => {
      if (!live) return;
      setGpu((g) => (p.ok ? { ...g, checked: true, available: true, name: p.name, reason: undefined } : { ...g, checked: true, available: false, reason: p.reason }));
    });
    const off = GpuMiner.onLost((message) => onGpuFail(`GPU lost: ${message}`, "lost"));
    return () => {
      live = false;
      off();
    };
  }, [onGpuFail, setGpu]);

  useEffect(() => () => terminate(), [terminate]);

  const state: MinerState = useMemo(
    () => ({ running, practice, engine, power, threads, auto, rate, hashes, seconds, sample, found, pending, log, bits, gpu }),
    [running, practice, engine, power, threads, auto, rate, hashes, seconds, sample, found, pending, log, bits, gpu],
  );

  return { state, start, stop, setPower, setEngine, setAuto, mintPending, fmtRate };
}
