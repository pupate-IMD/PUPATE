"use client";

// The miner as the page sees it: start and stop, power and engine, the live rate and the sample digest
// for the drawing, the hashes found, and the field log. Live mode (jobs from the contract, auto-mint
// through the wallet) plugs into the same hook when the contracts exist; today every run is a practice
// run with a practice target, and a found hash is logged, never minted.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Hex } from "viem";
import { type Engine, type FromWorker, type MinerJob, type Power, PRACTICE_BITS, fmtRate, leadingZeroBits, practiceJob, randomHex } from "./job";

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
  bits: number;
}

const CHUNK = 2000;

function stamp(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function useMiner() {
  const [engine, setEngine] = useState<Engine>("cpu");
  const [power, setPowerState] = useState<Power>(75);
  const [auto, setAuto] = useState(true);
  const [running, setRunning] = useState(false);
  const [practice, setPractice] = useState(true);
  const [rate, setRate] = useState(0);
  const [hashes, setHashes] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [sample, setSample] = useState<Hex | null>(null);
  const [found, setFound] = useState<Found[]>([]);
  const [pending, setPending] = useState<Found | null>(null);
  // The log starts empty on the server and gets its first line on the client, so the time stamp never
  // differs between the two renders.
  const [log, setLog] = useState<LogLine[]>([]);
  const [threads, setThreads] = useState(1);

  const workers = useRef<Worker[]>([]);
  const counts = useRef<number[]>([]);
  const t0 = useRef(0);
  const job = useRef<MinerJob | null>(null);
  const timer = useRef<number | null>(null);
  const foundN = useRef(0);
  const autoRef = useRef(auto);
  autoRef.current = auto;

  useEffect(() => {
    setThreads(Math.max(1, (navigator.hardwareConcurrency || 4) - 1));
    setLog([{ at: stamp(), text: "ready" }]);
  }, []);

  const say = useCallback((text: string, tone?: LogLine["tone"]) => {
    setLog((l) => [{ at: stamp(), text, tone }, ...l].slice(0, 40));
  }, []);

  const terminate = useCallback(() => {
    for (const w of workers.current) {
      w.postMessage({ type: "stop" });
      w.terminate();
    }
    workers.current = [];
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
  }, []);

  const dispatch = useCallback(
    (j: MinerJob) => {
      job.current = j;
      counts.current = Array(threads).fill(0);
      t0.current = performance.now();
      setHashes(0);
      setRate(0);
      for (let i = 0; i < threads; i++) {
        const w = workers.current[i];
        w.postMessage({ type: "start", job: j, nonceHigh: randomHex(32), power, worker: i, chunk: CHUNK });
      }
    },
    [threads, power],
  );

  const onMessage = useCallback(
    (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      if (!job.current || m.jobId !== job.current.id) return;
      if (m.type === "progress") {
        counts.current[m.worker] = (counts.current[m.worker] || 0) + m.hashes;
        if (m.sample !== "0x") setSample(m.sample);
        return;
      }
      // found
      const now = performance.now();
      const bits = leadingZeroBits(m.digest);
      const f: Found = {
        n: ++foundN.current,
        nonce: m.nonce,
        digest: m.digest,
        gilt: bits >= PRACTICE_BITS + 4,
        at: Date.now(),
        sinceStart: (now - t0.current) / 1000,
        minted: false,
      };
      if (autoRef.current) {
        f.minted = true;
        setFound((list) => [f, ...list]);
        say(f.gilt ? `valid hash, a gilt one · practice mint · mining the next one` : `valid hash found · practice mint · mining the next one`, f.gilt ? "gold" : "jade");
        // A real mint changes prevWork for everyone; a practice mint changes the folded word the same way.
        dispatch(practiceJob(job.current.id + 1, job.current.miner));
      } else {
        setFound((list) => [f, ...list]);
        setPending(f);
        say(f.gilt ? `valid hash found, a gilt one · mint it now` : `valid hash found · mint it now`, f.gilt ? "gold" : "jade");
        for (const w of workers.current) w.postMessage({ type: "stop" });
      }
    },
    [dispatch, say],
  );

  const start = useCallback(
    (opts: { miner?: Hex } = {}) => {
      terminate();
      setPractice(true);
      setPending(null);
      const pool: Worker[] = [];
      for (let i = 0; i < threads; i++) {
        const w = new Worker(new URL("./miner.worker.ts", import.meta.url), { type: "module" });
        w.onmessage = onMessage;
        pool.push(w);
      }
      workers.current = pool;
      dispatch(practiceJob(1, opts.miner));
      setRunning(true);
      say(`started on ${engine.toUpperCase()} at ${power}% power · ${threads} thread${threads > 1 ? "s" : ""} · practice job, real speed`);
      timer.current = window.setInterval(() => {
        const total = counts.current.reduce((a, b) => a + b, 0);
        const s = (performance.now() - t0.current) / 1000;
        setHashes(total);
        setSeconds(s);
        setRate(s > 0.5 ? total / s : 0);
      }, 500);
    },
    [dispatch, engine, onMessage, power, say, terminate, threads],
  );

  const stop = useCallback(() => {
    if (!workers.current.length) return;
    terminate();
    setRunning(false);
    say("stopped");
  }, [say, terminate]);

  /// The Mint button in a practice run: nothing is sent; the log says what a live mint would do.
  const mintPending = useCallback(() => {
    const f = pending;
    if (!f || !job.current) return;
    setFound((list) => list.map((x) => (x.n === f.n ? { ...x, minted: true } : x)));
    setPending(null);
    say("practice mint · live, your wallet would open to sign here", "dim");
    dispatch(practiceJob(job.current.id + 1, job.current.miner));
  }, [dispatch, pending, say]);

  const setPower = useCallback((p: Power) => {
    setPowerState(p);
    for (const w of workers.current) w.postMessage({ type: "power", power: p });
  }, []);

  useEffect(() => () => terminate(), [terminate]);

  const state: MinerState = useMemo(
    () => ({ running, practice, engine, power, threads, auto, rate, hashes, seconds, sample, found, pending, log, bits: PRACTICE_BITS }),
    [running, practice, engine, power, threads, auto, rate, hashes, seconds, sample, found, pending, log],
  );

  return { state, start, stop, setPower, setEngine, setAuto, mintPending, fmtRate };
}
