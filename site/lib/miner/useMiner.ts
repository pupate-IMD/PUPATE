"use client";

// The miner as the page sees it: start and stop, power and engine, the live rate and the sample digest
// for the drawing, the hashes found, and the field log. Two engines grind the same kind of job: the CPU,
// a pool of Web Workers (one per spare core), and the GPU, one WebGPU dispatch loop (gpu/gpuMiner.ts)
// whose hits are re-hashed on the CPU before they count. The GPU is offered when the browser has WebGPU
// and an adapter; the first time it is picked it runs a self-test, and its practice target follows the
// rate that test measured. A GPU that is lost or fails puts the miner back on the CPU by itself.
//
// Live mode, when the page hands over a LiveLink (the contracts exist on the chain): start({ live: true,
// wallet }) mines the contract's job (lib/metamorph/job.ts) on whichever engine is picked. Every three
// seconds, and at once after a mint, the job is read again and swapped in through the same dispatch when
// someone minted (prevWork moved), the target moved, or the anchor is ten blocks from leaving its window;
// a hash waiting to be minted is dropped then with the spec's line. A find is checked on the main thread
// against the job's own proof and whole target, then sent as a mint (lib/metamorph/mint.ts): at once with
// auto-mint on, else from the Mint button. A wallet rejection turns auto-mint off; gilt comes from the
// receipt. A mint is sent once: when the wallet's answer or the receipt goes missing, the chain is watched
// until it shows what became of it, and nothing is mined on its prevWork meanwhile. A run stops the moment
// the wallet disconnects or changes, and everything stops with the page: no engine, poll or wallet after it.
// A practice job says live: false, and its finds are never sent.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAddressEqual, type Address, type Hex, type PublicClient, type TransactionReceipt } from "viem";
import { metamorphAbi } from "../metamorph/abi";
import { type LiveAddresses, type LiveJob, anchorExpiring, isLiveJob, jobChanged, liveJob, meets, mineableSeats, workOf } from "../metamorph/job";
import {
  LINES,
  type MintOutcome,
  type Prepared,
  type Settled,
  type WriteContract,
  approvePupate,
  cardImage,
  errorText,
  findMinted,
  gasLine,
  isUserRejection,
  outcomeLines,
  parseMintReceipt,
  prepareMint,
  revertReason,
  sendMint,
  settleMint,
} from "../metamorph/mint";
import { type GpuFailure, GpuMiner } from "./gpu/gpuMiner";
import { type Engine, type FromWorker, type MinerJob, type Power, PRACTICE_BITS, fmtRate, leadingZeroBits, practiceBitsFor, practiceJob, randomHex } from "./job";

/// A card this session minted, read from the mint's receipt.
export interface MintCard {
  id: number;
  seat: number;
  gilt: boolean;
  /// This session's mints, counted from 1: the drawer's places.
  k: number;
  /// The mint's transaction, when the receipt was seen.
  hash?: Hex;
  /// The card's image from tokenURI (a data URI), once read.
  image?: string;
}

export interface Found {
  n: number;
  nonce: Hex;
  digest: Hex;
  /// Practice: four more leading zero bits than the target asks, one in sixteen. Live: the receipt's word.
  gilt: boolean;
  at: number;
  sinceStart: number;
  minted: boolean;
  /// Found on a job from the contract.
  live?: boolean;
  /// Live: the card the mint made.
  card?: MintCard;
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
  /// Why the GPU was set aside after failing its CPU checks while mining (its self-test had passed); it
  /// stays off until the page reloads.
  failed?: string;
}

export interface MinerState {
  running: boolean;
  practice: boolean;
  /// The run (or the hash waiting to be minted) is on the contract's job: finds are sent as mints.
  live: boolean;
  engine: Engine;
  power: Power;
  threads: number;
  auto: boolean;
  rate: number;
  hashes: number;
  seconds: number;
  sample: Hex | null;
  /// The newest finds, at most FOUND_KEPT of them (the drawer shows eight).
  found: Found[];
  /// Every find this session, and the gilt ones among them, however many `found` still holds.
  tally: { found: number; gilt: number };
  /// A found hash waiting for the Mint button (auto-mint off).
  pending: Found | null;
  log: LogLine[];
  /// The leading zero bits of the job being mined: the practice target, or live the contract's bits().
  bits: number;
  gpu: GpuState;
  /// Live: the mint price of the job being mined, in PUPATE wei; null in a practice run.
  price: bigint | null;
  /// Live: a mint is on its way (the wallet is open, or the block is awaited).
  minting: boolean;
  /// Live: the mint left the wallet, or may have (the wallet failed once asked), and the chain is awaited.
  sent: boolean;
  /// The PUPATE approval is on its way.
  approving: boolean;
  /// Live: the newest card this session minted.
  lastMint: MintCard | null;
}

/// What live mode needs from the page: the target chain's public client and addresses (with Metamorph
/// MD), the wallet's write, and the wallet connected right now (a live run stops when it changes).
export interface LiveLink {
  client: PublicClient;
  addresses: LiveAddresses;
  write: WriteContract;
  wallet: Address | null;
}

export interface StartOptions {
  /// Mine the contract's job and send finds as mints from `wallet`; needs the LiveLink.
  live?: boolean;
  wallet?: Address;
  /// A practice run's miner word (the wallet when one is connected, for realism; random otherwise).
  miner?: Hex;
}

const CHUNK = 2000;
/// Finds kept in state; the count of all of them lives in `tally`.
const FOUND_KEPT = 64;
/// CPU threads write their index (0..254) into nonce byte 24 and the GPU writes 0xff there, so the two
/// engines' nonces never meet: at most 255 threads, whatever the machine reports.
const MAX_CPU_THREADS = 255;
/// How often a live run reads the chain for its job.
const POLL_MS = 3000;
/// The pause before the one retry of a mint that met a network error before the wallet was asked to send.
/// The pause before prepareMint's one retry: long enough to outlast a public endpoint's rate-limit window.
const RETRY_MS = 4000;
/// How long a sent mint's receipt is waited for before the chain is watched for it instead (settleMint),
/// which also sees someone else's mint and the end of the anchor's window.
const RECEIPT_MS = 120_000;

function stamp(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

export function useMiner(link: LiveLink | null = null) {
  const [engine, setEngineState] = useState<Engine>("cpu");
  const [power, setPowerState] = useState<Power>(75);
  const [auto, setAuto] = useState(true);
  const [running, setRunning] = useState(false);
  const [practice, setPractice] = useState(true);
  const [live, setLive] = useState(false);
  const [rate, setRate] = useState(0);
  const [hashes, setHashes] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [sample, setSample] = useState<Hex | null>(null);
  const [found, setFound] = useState<Found[]>([]);
  const [tally, setTally] = useState({ found: 0, gilt: 0 });
  const [pending, setPendingState] = useState<Found | null>(null);
  // The log starts empty on the server and gets its first line on the client, so the time stamp never
  // differs between the two renders.
  const [log, setLog] = useState<LogLine[]>([]);
  const [threads, setThreads] = useState(1);
  const [bits, setBits] = useState(PRACTICE_BITS);
  const [gpu, setGpuState] = useState<GpuState>({ checked: false, available: false });
  const [price, setPrice] = useState<bigint | null>(null);
  const [minting, setMintingState] = useState(false);
  const [sent, setSent] = useState(false);
  const [approving, setApproving] = useState(false);
  const [lastMint, setLastMint] = useState<MintCard | null>(null);

  const workers = useRef<Worker[]>([]);
  const gpuMiner = useRef<GpuMiner | null>(null);
  /// Hashes per CPU worker; the GPU counts in slot 0.
  const counts = useRef<number[]>([]);
  const t0 = useRef(0);
  const job = useRef<MinerJob | null>(null);
  const timer = useRef<number | null>(null);
  const foundN = useRef(0);
  const sampledAt = useRef(0);
  // What callbacks that outlive a render (worker and GPU messages, the self-test, the poller, a mint on its
  // way) read at call time.
  const autoRef = useRef(auto);
  autoRef.current = auto;
  const linkRef = useRef<LiveLink | null>(link);
  linkRef.current = link;
  const engineRef = useRef<Engine>("cpu");
  const powerRef = useRef<Power>(75);
  const threadsRef = useRef(1);
  const runningRef = useRef(false);
  const pendingRef = useRef<Found | null>(null);
  const gpuRef = useRef<GpuState>(gpu);
  const gpuBits = useRef(PRACTICE_BITS);
  /// The engine the visitor asked for last; a self-test that ends after they went back to the CPU stays put.
  const wanted = useRef<Engine>("cpu");
  /// Set when the device is lost while the self-test runs: that test's result says nothing about the GPU.
  const lostInTest = useRef<string | null>(null);
  // dispatch and the found handler call each other, and the GPU's failure handler switches engines.
  const dispatchRef = useRef<(j: MinerJob) => void>(() => {});
  const switchRef = useRef<(e: Engine) => void>(() => {});
  /// Every job gets a fresh id, practice or live, so a message from an engine about an older job (a
  /// practice find arriving after a live run started, say) never matches the job being mined.
  const jobSeq = useRef(0);
  /// Bumped by every start and stop, so a live start still reading the chain knows it was overtaken.
  const runSeq = useRef(0);
  /// Live mode's own: the run is on the contract's job, the wallet it mines for, the job of the hash
  /// waiting for the Mint button, a mint on its way, the engines paused (a find waits or is being sent),
  /// the poll timer and its guard, the polls that failed in a row, and this session's mints.
  const liveRef = useRef(false);
  const walletRef = useRef<Address | null>(null);
  const pendingJob = useRef<LiveJob | null>(null);
  const mintingRef = useRef(false);
  const idle = useRef(true);
  const poll = useRef<number | null>(null);
  const polling = useRef(false);
  /// A poll asked for while another was on its way runs when that one ends.
  const pollAgain = useRef(false);
  /// Bumped when a mint starts and when it ends: a job read across either is stale and is dropped.
  const mintGen = useRef(0);
  /// The prevWork this session's last mint replaced: a node that still shows it is behind the receipt, and
  /// its job is skipped rather than mined (a find on it would read as someone else's win), for a few polls
  /// at most, in case the block that held the mint was dropped.
  const replaced = useRef<Hex | null>(null);
  const replacedSkips = useRef(0);
  const misses = useRef(0);
  const mintsK = useRef(0);
  const approvingRef = useRef(false);
  /// The page is there. Set by the effect below, cleared when the page is left: nothing mines, polls or opens
  /// the wallet after that.
  const mounted = useRef(false);
  const mintRef = useRef<(f: Found, j: LiveJob) => Promise<void>>(async () => {});
  const refreshRef = useRef<() => Promise<void>>(async () => {});

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

  const setMinting = useCallback((on: boolean) => {
    mintingRef.current = on;
    mintGen.current++;
    setMintingState(on);
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

  /// Stops both engines, the rate timer and the live poll.
  const terminate = useCallback(() => {
    dropWorkers();
    gpuMiner.current?.stop();
    idle.current = true;
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    if (poll.current) window.clearInterval(poll.current);
    poll.current = null;
  }, [dropWorkers]);

  /// Rests both engines without ending the run: a find waits for the Mint button or is being sent. The
  /// next dispatch wakes them.
  const pauseEngines = useCallback(() => {
    for (const w of workers.current) w.postMessage({ type: "stop" });
    gpuMiner.current?.stop();
    idle.current = true;
  }, []);

  const autoOff = useCallback(() => {
    autoRef.current = false;
    setAuto(false);
  }, []);

  /// A live find: checked on the main thread before the wallet is asked, as the contract will check it (the
  /// proof through viem's encoder, apart from the engines' byte builders, must be the digest reported and
  /// below the job's whole target; a practice find cannot pass, its preimage is a practice job's). Then the
  /// engines rest, and the hash is sent at once with auto-mint on, or waits for the Mint button.
  const foundLive = useCallback(
    (j: LiveJob, nonce: Hex, digest: Hex) => {
      const work = workOf(j, BigInt(nonce));
      if (work !== digest.toLowerCase() || !meets(j, work)) {
        say("a find failed its check on the CPU and was set aside", "dim");
        return;
      }
      const f: Found = {
        n: ++foundN.current,
        nonce,
        digest: work,
        gilt: false,
        at: Date.now(),
        sinceStart: (performance.now() - t0.current) / 1000,
        minted: false,
        live: true,
      };
      setFound((list) => [f, ...list].slice(0, FOUND_KEPT));
      setTally((t) => ({ ...t, found: t.found + 1 }));
      pauseEngines();
      if (autoRef.current) {
        void mintRef.current(f, j);
        return;
      }
      pendingJob.current = j;
      setPending(f);
      say("valid hash found · mint it now", "jade");
    },
    [pauseEngines, say, setPending],
  );

  const onFound = useCallback(
    (jobId: number, nonce: Hex, digest: Hex) => {
      const j = job.current;
      if (!j || jobId !== j.id || pendingRef.current || mintingRef.current) return;
      if (isLiveJob(j)) {
        // Resting engines may still have a find in the post; it is for a job already being minted or dropped.
        if (!idle.current) foundLive(j, nonce, digest);
        return;
      }
      const f: Found = {
        n: ++foundN.current,
        nonce,
        digest,
        gilt: leadingZeroBits(digest) >= j.bits + 4,
        at: Date.now(),
        sinceStart: (performance.now() - t0.current) / 1000,
        minted: autoRef.current,
      };
      setFound((list) => [f, ...list].slice(0, FOUND_KEPT));
      setTally((t) => ({ found: t.found + 1, gilt: t.gilt + (f.gilt ? 1 : 0) }));
      if (f.minted) {
        say(f.gilt ? `valid hash, a gilt one · practice mint · mining the next one` : `valid hash found · practice mint · mining the next one`, f.gilt ? "gold" : "jade");
        // A real mint changes prevWork for everyone; a practice mint changes the folded word the same way.
        dispatchRef.current(practiceJob(++jobSeq.current, j.miner, engineBits()));
      } else {
        setPending(f);
        say(f.gilt ? `valid hash found, a gilt one · mint it now` : `valid hash found · mint it now`, f.gilt ? "gold" : "jade");
        for (const w of workers.current) w.postMessage({ type: "stop" });
        gpuMiner.current?.stop();
      }
    },
    // engineBits reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [foundLive, say, setPending],
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

  /// The GPU stopped itself, or its device was lost. Failed CPU checks set it aside until reload; a lost or
  /// failing device gets a fresh self-test the next time it is picked. Either way the miner goes back to
  /// the CPU. A loss while the self-test runs is left to setEngine, which voids that test.
  const onGpuFail = useCallback(
    (reason: string, kind: GpuFailure) => {
      if (kind === "lost" && gpuRef.current.selfTest?.running) {
        lostInTest.current = reason;
        return;
      }
      setGpu((g) => (kind === "verify" ? { ...g, failed: reason } : { ...g, selfTest: undefined }));
      if (engineRef.current !== "gpu") {
        if (kind === "lost") say(`${reason} · a fresh self-test runs when GPU is picked again`, "dim");
        return;
      }
      say(`${reason} · back on the CPU`, "dim");
      wanted.current = "cpu";
      switchRef.current("cpu");
    },
    [say, setGpu],
  );

  /// Hands a job to the engine in use: the CPU workers or the GPU, practice or live alike.
  const dispatch = useCallback(
    (j: MinerJob) => {
      job.current = j;
      idle.current = false;
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

  /// The rate timer: hashes and seconds of the job being mined, twice a second.
  const startClock = useCallback(() => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = window.setInterval(() => {
      const total = counts.current.reduce((a, b) => a + b, 0);
      const s = (performance.now() - t0.current) / 1000;
      setHashes(total);
      setSeconds(s);
      setRate(s > 0.5 ? total / s : 0);
    }, 500);
  }, []);

  /// A minted card: the receipt's lines, the find marked with its card, the card's image read once.
  const landed = useCallback(
    (f: Found, o: MintOutcome, hash?: Hex) => {
      const lines = outcomeLines(o, runningRef.current);
      const m = o.minted;
      lines.forEach((line, i) => say(line, !m ? "dim" : i === 0 && m.gilt ? "gold" : "jade"));
      if (!m) return;
      const card: MintCard = { id: Number(m.id), seat: Number(m.seat), gilt: m.gilt, k: ++mintsK.current, hash };
      setFound((list) => list.map((x) => (x.n === f.n ? { ...x, minted: true, gilt: m.gilt, card } : x)));
      if (m.gilt) setTally((t) => ({ ...t, gilt: t.gilt + 1 }));
      setLastMint(card);
      const l = linkRef.current;
      if (!l) return;
      void cardImage(l.client, l.addresses, m.id)
        .then((image) => {
          if (!image) return;
          setFound((list) => list.map((x) => (x.card?.k === card.k ? { ...x, card: { ...x.card, image } } : x)));
          setLastMint((c) => (c?.k === card.k ? { ...c, image } : c));
        })
        .catch(() => undefined);
    },
    [say],
  );

  /// Ends a run. The engines, the clock and the poll stop, and the readings go back to the chain's (no job is
  /// on); a live hash that waited for the Mint button is dropped, with a word: nothing would watch it now, and
  /// the button would be the only way on. A mint already on its way finishes by itself.
  const end = useCallback(
    (line: string, tone?: LogLine["tone"]) => {
      runSeq.current++;
      runningRef.current = false;
      liveRef.current = false;
      terminate();
      setRunning(false);
      setLive(false);
      setPrice(null);
      const dropped = !!pendingRef.current?.live;
      if (dropped) {
        setPending(null);
        pendingJob.current = null;
      }
      say(dropped ? `${line} · ${LINES.dropped}` : line, tone);
    },
    [say, setPending, terminate],
  );

  /// Ends a live run that cannot go on (nothing to mine, all minted, the wallet changed).
  const halt = useCallback((line: string) => end(line, "dim"), [end]);

  /// A line that ends "· mining again" says so only while the miner runs: a mint can end after its run.
  const again = useCallback((line: string) => (runningRef.current ? line : line.replace(/ · mining again$/, "")), []);

  /// Sends a live find as a mint: the checks and the approval (prepareMint), the padded gas limit, the
  /// wallet, the block, the receipt. One retry after a network error before the wallet is asked to send; a
  /// second error leaves the hash waiting for the Mint button (it stays valid for the anchor's window, so it is
  /// never lost to the page). Once the wallet is asked, the mint is never sent again: a wallet that fails once asked (it may have sent it) or a receipt
  /// that does not come leaves the chain watched (settleMint) until it shows what became of the mint, and
  /// nothing is mined on its prevWork meanwhile. A reverted receipt is told apart by the chain. A refusal of
  /// the wallet turns auto-mint off and leaves the hash waiting for the Mint button while the run is on. The
  /// wallet opens only while the page is there. Afterwards the job is read at once.
  const mintLive = useCallback(
    async (f: Found, j: LiveJob) => {
      const l = linkRef.current;
      const wallet = walletRef.current;
      if (!l || !wallet || mintingRef.current) return;
      // A proof is bound to the wallet it was mined for; sent from another it can only revert.
      const sameWallet = () => {
        const now = linkRef.current?.wallet;
        if (now && isAddressEqual(now, wallet)) return true;
        say("the wallet changed · that hash was mined for the other one", "dim");
        return false;
      };
      if (!sameWallet()) return;
      setMinting(true);
      say(LINES.found, "jade");
      const nonce = BigInt(f.nonce);
      const write: WriteContract = (call) => (mounted.current ? l.write(call) : Promise.reject(new Error("the page was left")));
      const wait = (why: string, tone: LogLine["tone"]) => {
        say(why, tone);
        if (!runningRef.current) {
          say(LINES.droppedStopped, "dim");
          return;
        }
        pendingJob.current = j;
        setPending(f);
      };
      /// prepareMint, tried once more after a network error (nothing was sent yet); null when the attempt ends.
      const prepare = async (): Promise<Prepared | null> => {
        for (let attempt = 0; ; attempt++) {
          try {
            return await prepareMint(l.client, l.addresses, { wallet, job: j, nonce, work: f.digest, write, onApprove: () => say(LINES.approving) });
          } catch (e) {
            if (!mounted.current) return null;
            if (isUserRejection(e)) {
              // The approval was declined.
              autoOff();
              wait(LINES.declined, "dim");
              return null;
            }
            if (attempt >= 1) {
              // Nothing was sent: the find is still good, so it waits for Mint it now instead of being thrown away.
              wait(`the mint did not go through: ${errorText(e)} · your hash waits for Mint it now`, "dim");
              return null;
            }
            say(`the network stumbled: ${errorText(e)} · trying once more`, "dim");
            await sleep(RETRY_MS);
            if (!mounted.current) return null;
          }
        }
      };
      const watch = (hash: Hex | null) =>
        settleMint(l.client, l.addresses, {
          wallet,
          job: j,
          work: f.digest,
          hash,
          pause: () => sleep(POLL_MS),
          gone: () => !mounted.current,
          onMiss: (e, n) => {
            if (n === 3) say(`the chain is not answering: ${errorText(e)} · still trying`, "dim");
          },
        });
      /// What the chain did with the mint: the card and its receipt's lines; why it reverted (its block past
      /// the anchor's window, someone's mint first, or another refusal); a card found again without its
      /// receipt; the lost race; a mint that did not land while it could.
      const told = async (s: Settled | null) => {
        if (!s || !mounted.current) return;
        if (s.kind === "receipt") {
          const o = parseMintReceipt(s.receipt, l.addresses, wallet);
          if (o.minted) {
            replaced.current = j.prevWork;
            replacedSkips.current = 0;
            landed(f, o, s.receipt.transactionHash);
            return;
          }
          if (s.receipt.status !== "reverted") return say(again(LINES.lost), "dim");
          const late = revertReason(j, s.receipt.blockNumber, null) === "late";
          const now = late ? null : await l.client.readContract({ address: l.addresses.metamorph, abi: metamorphAbi, functionName: "prevWork" }).catch(() => null);
          const why = revertReason(j, s.receipt.blockNumber, now);
          say(again(why === "late" ? LINES.late : why === "lost" ? LINES.lost : LINES.reverted), "dim");
        } else if (s.kind === "landed") {
          replaced.current = j.prevWork;
          replacedSkips.current = 0;
          if (s.card) landed(f, { status: "success", minted: s.card, duties: [], lost: false });
          else say(`your mint landed${runningRef.current ? " · mining the next one" : ""}`, "jade");
        } else say(again(s.kind === "lost" ? LINES.lost : LINES.unseen), "dim");
      };
      try {
        const prep = await prepare();
        if (!prep || !mounted.current) return;
        if (!prep.ok) {
          if (prep.why === "short") {
            autoOff();
            wait(LINES.short, "gold");
          } else if (prep.why === "landed") {
            // The send's answer went missing but the mint landed: prevWork is this hash's proof.
            const card = await findMinted(l.client, l.addresses, wallet, f.digest, j.block - 1n).catch(() => null);
            await told({ kind: "landed", card });
          } else if (prep.why === "nothing" || prep.why === "soldOut") {
            halt(prep.why === "nothing" ? LINES.nothing : LINES.soldOut);
          } else {
            say(again(prep.why === "lost" ? LINES.lost : prep.why === "expired" ? LINES.expired : LINES.difficulty), "dim");
          }
          return;
        }
        if (!sameWallet()) return;
        say(gasLine(prep.gas, prep.gas > prep.estimate), "dim");
        let hash: Hex;
        try {
          hash = await sendMint(write, l.addresses, j.anchor, nonce, prep.gas);
        } catch (e) {
          if (!mounted.current) return;
          if (isUserRejection(e)) {
            autoOff();
            wait(LINES.declined, "dim");
            return;
          }
          // The wallet may have sent the mint before it failed: it is never sent again, and the chain is
          // watched until it shows what became of it.
          setSent(true);
          say(`the wallet did not say whether the mint was sent: ${errorText(e)} · watching for it`, "dim");
          await told(await watch(null));
          return;
        }
        setSent(true);
        let receipt: TransactionReceipt;
        try {
          receipt = await l.client.waitForTransactionReceipt({ hash, timeout: RECEIPT_MS });
        } catch (e) {
          if (!mounted.current) return;
          say(`the mint was sent but its block is not seen yet: ${errorText(e)} · watching for it`, "dim");
          await told(await watch(hash));
          return;
        }
        await told({ kind: "receipt", receipt });
      } finally {
        setMinting(false);
        setSent(false);
        if (mounted.current && liveRef.current && runningRef.current) void refreshRef.current();
      }
    },
    [again, autoOff, halt, landed, say, setMinting, setPending],
  );
  mintRef.current = mintLive;

  /// The live poll: the job as the chain stands, swapped in when someone minted, the target moved, the
  /// anchor nears the end of its window, or the engines rest after a mint. A hash waiting for the Mint
  /// button is dropped once someone minted or its anchor is about to expire. Only while the run is on, and
  /// skipped while a mint is on its way (that mint reads the job itself when it is done); a read that a stop,
  /// a start, the page's end or a mint overtook is dropped, never dispatched.
  const refreshJob = useCallback(async () => {
    const l = linkRef.current;
    const wallet = walletRef.current;
    if (!liveRef.current || !runningRef.current || !l || !wallet || mintingRef.current) return;
    if (polling.current) {
      pollAgain.current = true;
      return;
    }
    if (!l.wallet || !isAddressEqual(l.wallet, wallet)) {
      halt(l.wallet ? LINES.walletChanged : LINES.walletGone);
      return;
    }
    polling.current = true;
    const gen = mintGen.current;
    const run = runSeq.current;
    try {
      const next = await liveJob(l.client, l.addresses, wallet);
      misses.current = 0;
      if (run !== runSeq.current || !liveRef.current || !runningRef.current || gen !== mintGen.current || mintingRef.current) return;
      if (replaced.current && next.prevWork === replaced.current && ++replacedSkips.current <= 5) return;
      replaced.current = null;
      setPrice(next.price);
      const held = pendingJob.current;
      if (pendingRef.current && held) {
        const voided = held.prevWork !== next.prevWork;
        if (!voided && !anchorExpiring(held, next.block)) return;
        setPending(null);
        pendingJob.current = null;
        say(voided ? LINES.lost : LINES.expired, "dim");
      }
      const cur = job.current;
      if (idle.current || !isLiveJob(cur) || jobChanged(cur, next) || anchorExpiring(cur, next.block)) dispatch({ ...next, id: ++jobSeq.current });
    } catch (e) {
      if (run === runSeq.current && ++misses.current === 3) say(`the chain is not answering: ${errorText(e)} · still trying`, "dim");
    } finally {
      polling.current = false;
      if (pollAgain.current) {
        pollAgain.current = false;
        void refreshRef.current();
      }
    }
  }, [dispatch, halt, say, setPending]);
  refreshRef.current = refreshJob;

  /// A live run: the miner runs at once (the button turns to Stop), reads whether anything is mineable and
  /// the first job, then mines it and polls every three seconds. A stop, another start or the page's end
  /// meanwhile wins: nothing is dispatched after it.
  const startLive = useCallback(
    async (wallet: Address | undefined, run: number) => {
      const l = linkRef.current;
      if (!l || !wallet) {
        say("live mining needs the contracts on this chain and a wallet", "dim");
        return;
      }
      liveRef.current = true;
      setLive(true);
      setPractice(false);
      setPrice(null);
      walletRef.current = wallet;
      job.current = null;
      runningRef.current = true;
      setRunning(true);
      startClock();
      let first: LiveJob;
      const overtaken = () => run !== runSeq.current || !liveRef.current || !runningRef.current;
      try {
        const [open, j] = await Promise.all([mineableSeats(l.client, l.addresses), liveJob(l.client, l.addresses, wallet)]);
        if (overtaken()) return;
        if (open.length === 0) return halt(LINES.nothing);
        first = j;
      } catch (e) {
        if (overtaken()) return;
        return halt(`the chain did not answer: ${errorText(e)}`);
      }
      setPrice(first.price);
      dispatch({ ...first, id: ++jobSeq.current });
      const n = threadsRef.current;
      const where = engineRef.current === "gpu" ? `${gpuRef.current.name ?? "WebGPU"}` : `${n} thread${n > 1 ? "s" : ""}`;
      say(`started on ${engineRef.current.toUpperCase()} at ${powerRef.current}% power · ${where} · live, ${first.bits} bits`);
      poll.current = window.setInterval(() => void refreshRef.current(), POLL_MS);
    },
    [dispatch, halt, say, startClock],
  );

  const start = useCallback(
    (opts: StartOptions = {}) => {
      terminate();
      setPending(null);
      pendingJob.current = null;
      const run = ++runSeq.current;
      if (opts.live) {
        void startLive(opts.wallet, run);
        return;
      }
      liveRef.current = false;
      setLive(false);
      setPrice(null);
      setPractice(true);
      dispatch(practiceJob(++jobSeq.current, opts.miner, engineBits()));
      runningRef.current = true;
      setRunning(true);
      const n = threadsRef.current;
      const where = engineRef.current === "gpu" ? `${gpuRef.current.name ?? "WebGPU"}` : `${n} thread${n > 1 ? "s" : ""}`;
      say(`started on ${engineRef.current.toUpperCase()} at ${powerRef.current}% power · ${where} · practice job, real speed`);
      startClock();
    },
    // engineBits reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dispatch, say, setPending, startClock, startLive, terminate],
  );

  /// The Stop button. A live hash waiting for the Mint button goes with the run (end says so).
  const stop = useCallback(() => {
    if (!runningRef.current) return;
    end("stopped");
  }, [end]);

  /// The Mint button. Live, the waiting hash is sent as a mint. In a practice run nothing is sent; the log
  /// says what a live mint would do.
  const mintPending = useCallback(() => {
    const f = pendingRef.current;
    if (!f) return;
    if (f.live) {
      const j = pendingJob.current;
      if (!j || mintingRef.current) return;
      setPending(null);
      pendingJob.current = null;
      void mintRef.current(f, j);
      return;
    }
    if (!job.current) return;
    setFound((list) => list.map((x) => (x.n === f.n ? { ...x, minted: true } : x)));
    setPending(null);
    say("practice mint · live, your wallet would open to sign here", "dim");
    if (runningRef.current) dispatch(practiceJob(++jobSeq.current, job.current.miner, engineBits()));
    // engineBits reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, say, setPending]);

  /// The Approve PUPATE button: the token may take PUPATE for every mint from now on. True when it landed.
  const approve = useCallback(async (): Promise<boolean> => {
    const l = linkRef.current;
    if (!l || approvingRef.current) return false;
    approvingRef.current = true;
    setApproving(true);
    say(LINES.approving);
    try {
      await approvePupate(l.client, l.addresses, l.write);
      say(LINES.approved, "jade");
      return true;
    } catch (e) {
      say(isUserRejection(e) ? "you declined the approval in your wallet" : `the approval did not go through: ${errorText(e)}`, "dim");
      return false;
    } finally {
      approvingRef.current = false;
      setApproving(false);
    }
  }, [say]);

  const setPower = useCallback((p: Power) => {
    powerRef.current = p;
    setPowerState(p);
    for (const w of workers.current) w.postMessage({ type: "power", power: p });
    gpuMiner.current?.setPower(p);
  }, []);

  /// Puts the miner on engine `e`. A running practice miner moves its search there with a fresh practice
  /// job; a live run moves the contract's job as it is (both engines grind the same MinerJob), and never a
  /// practice job, whether or not its first job has arrived.
  const switchTo = useCallback(
    (e: Engine) => {
      engineRef.current = e;
      setEngineState(e);
      if (liveRef.current) {
        say(`engine: ${engineText(e)}`);
        const cur = job.current;
        if (isLiveJob(cur) && runningRef.current && !pendingRef.current && !mintingRef.current && !idle.current) dispatch({ ...cur, id: ++jobSeq.current });
        return;
      }
      const b = engineBits();
      say(`engine: ${engineText(e)} · practice target ${b} bits`);
      if (runningRef.current && !pendingRef.current && job.current) dispatch(practiceJob(++jobSeq.current, job.current.miner, b));
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
      if (!g.available || g.failed || g.selfTest?.running || (g.selfTest && !g.selfTest.ok)) return;
      if (!g.selfTest) {
        lostInTest.current = null;
        setGpu((s) => ({ ...s, selfTest: { running: true, ok: false, rate: 0, batch: 0, detail: "" } }));
        say("GPU self-test: a known hash, 256 hits checked on the CPU, one second of work", "dim");
        const r = await GpuMiner.selfTest();
        // The page was left during the test: nothing is switched or mined after it.
        if (!mounted.current) return;
        if (lostInTest.current) {
          // The device went away mid-test, so the result says nothing about the GPU: it is tested afresh, on
          // a new device, the next time it is picked.
          setGpu((s) => ({ ...s, selfTest: undefined }));
          say(`${lostInTest.current} during the self-test · pick GPU to test it again`, "dim");
          lostInTest.current = null;
          return;
        }
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
    const n = Math.min(MAX_CPU_THREADS, Math.max(1, (navigator.hardwareConcurrency || 4) - 1));
    threadsRef.current = n;
    setThreads(n);
    setLog([{ at: stamp(), text: "ready" }]);
    let live = true;
    void GpuMiner.probe().then((p) => {
      if (!live) return;
      setGpu((g) => (p.ok ? { ...g, checked: true, available: true, name: p.name, reason: undefined } : { ...g, checked: true, available: false, reason: p.reason }));
      if (!p.ok) say(`GPU unavailable: ${p.reason}`, "dim");
    });
    const off = GpuMiner.onLost((message) => onGpuFail(`GPU lost: ${message}`, "lost"));
    return () => {
      live = false;
      off();
    };
  }, [onGpuFail, say, setGpu]);

  // The page is gone: nothing may mine, poll or open the wallet after it. The run's markers change first, so
  // every continuation still on its way (a start's first reads, a poll, a mint, a GPU self-test) sees it.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      runSeq.current++;
      runningRef.current = false;
      liveRef.current = false;
      terminate();
    };
  }, [terminate]);

  // The wallet connected right now: a live run stops the moment it disconnects or becomes another one (a
  // proof is bound to the wallet it was mined for). A find on its way meets the same check before the wallet.
  const connected = link ? link.wallet : undefined;
  useEffect(() => {
    const mining = walletRef.current;
    if (connected === undefined || !mining || !liveRef.current || !runningRef.current) return;
    if (!connected) halt(LINES.walletGone);
    else if (!isAddressEqual(connected, mining)) halt(LINES.walletChanged);
  }, [connected, halt]);

  const state: MinerState = useMemo(
    () => ({
      running,
      practice,
      live,
      engine,
      power,
      threads,
      auto,
      rate,
      hashes,
      seconds,
      sample,
      found,
      tally,
      pending,
      log,
      bits,
      gpu,
      price,
      minting,
      sent,
      approving,
      lastMint,
    }),
    [running, practice, live, engine, power, threads, auto, rate, hashes, seconds, sample, found, tally, pending, log, bits, gpu, price, minting, sent, approving, lastMint],
  );

  return { state, start, stop, setPower, setEngine, setAuto, mintPending, approve, fmtRate };
}
