// The GPU engine: one WebGPU device, the unrolled keccak shader (keccak.ts), and a dispatch loop that
// gives every thread one nonce. The host keeps the midstate and the nonce bookkeeping (words.ts). After
// each dispatch it reads back a small buffer (the hit count, up to 16 hit records, thread 0's digest for
// the drawing), rebuilds each hit's nonce, re-hashes the 192-byte preimage on the CPU with keccak_256 and
// only then reports it. Every few seconds it also re-hashes thread 0's nonce on the CPU and compares the
// digest with the GPU's sample, so a GPU that hashes wrongly is caught even when it reports no hits. A hit
// or a sample that fails its check is a strike against the device; the third strike stops the engine.
//
// The batch adapts to the GPU: it starts at 2^18 threads, stays within 2^14..2^22, and doubles or halves
// to keep each dispatch within a band of times. At full power two dispatches are in flight: one runs while
// the host reads the other back, so the GPU never waits on the round trip; on a visible page the band is
// then 8..24 ms, so a dispatch fits in a frame and the page's own drawing, which queues on the same GPU,
// never waits long behind one. Otherwise (a hidden page, or less than full power) the band is 60..120 ms.
// Power is a duty cycle, as on the CPU: after a dispatch that took t ms the loop rests
// t × (100 − power) / power ms, and it always yields between dispatches.
//
// The probe asks only for an adapter, which names the GPU; the device is requested at the first self-test,
// so a visitor who never picks the GPU never holds one.
//
// GpuMiner.selfTest runs before the first job: (a) a known answer: thread 0's digest for a fixed job and
// nonce must equal keccak_256 of the same 192 bytes on the CPU; (b) the hit path: at bits 0 each of 256
// threads hits, and every record must rebuild into a nonce whose CPU digest matches the GPU's words;
// (c) one second of work at an unreachable difficulty gives the rate, and must find nothing.
import { keccak_256 } from "@noble/hashes/sha3";
import type { Hex } from "viem";
import { type MinerJob, type Power, targetWords } from "../job";
import { KECCAK_WGSL, WORKGROUP_SIZE } from "./keccak";
import { BufferUsage, MapMode, type GpuAdapter, type GpuApi, type GpuBindGroup, type GpuBuffer, type GpuComputePipeline, type GpuDevice } from "./webgpu";
import { BATCH_LIMIT, NONCE_HIGH_BYTES, PARAM_WORDS, below, blockTwo, bytesHex, digestWords, gpuNonce, hexBytes, midstate, paramWords, preimage } from "./words";

const START_THREADS = 1 << 18;
/// The floor departs from the design's 2^18 on purpose: a slow GPU (an integrated or a mobile one) that
/// needs more than 120 ms for 2^18 threads keeps halving its dispatches, so the page's frames still get through.
const MIN_THREADS = 1 << 14;
const MAX_THREADS = 1 << 22;
/// Dispatch times the batch keeps to: it doubles below the first and halves above the second.
type Band = readonly [growBelow: number, shrinkAbove: number];
const FRAME_MS: Band = [8, 24];
const LONG_MS: Band = [60, 120];
/// Frame-sized dispatches on a visible page at full power. Below full power each dispatch runs alone
/// between rests, and a frame-sized one would spend a large share of its time on the round trip (a fifth
/// of an integrated GPU's rate at 75% power, measured), so there the band stays LONG_MS. Off, it always is.
const FRAME_SIZED = true;
/// Dispatches in flight at full power; below it, one at a time, since the rests are the point.
const IN_FLIGHT = 2;
/// Hit records a mining dispatch keeps; more hits than this in one dispatch are counted, not recorded.
const HIT_SLOTS = 16;
/// Strikes (a hit or a sample that failed the CPU check) a device takes before the engine stops itself.
const MAX_STRIKES = 3;
/// How often the loop re-hashes thread 0's nonce on the CPU to check the GPU's sample digest.
const SAMPLE_CHECK_MS = 3000;
/// The output buffer: the hit count and padding (16 bytes), thread 0's digest (32), then 16 bytes a record.
const OUT_HEAD = 48;

export interface GpuProgress {
  jobId: number;
  hashes: number;
  sample: Hex;
}

export interface GpuHit {
  jobId: number;
  nonce: Hex;
  digest: Hex;
}

/// Why the engine stopped itself: the device was lost, the GPU failed, or its hits failed the CPU check.
export type GpuFailure = "lost" | "error" | "verify";

export interface GpuStartOptions {
  power: Power;
  onProgress: (p: GpuProgress) => void;
  onFound: (h: GpuHit) => void;
  onLog: (text: string) => void;
  onFail: (reason: string, kind: GpuFailure) => void;
}

export interface GpuSelfTest {
  ok: boolean;
  name: string;
  /// Hashes per second over the benchmark (one second when the page runs the self-test).
  rate: number;
  detail: string;
  /// Threads (hashes) per dispatch the batch settled at, and how long that dispatch took.
  batch: number;
  dispatchMs: number;
  dispatches: number;
  compileMs: number;
}

type Probe = { ok: true; name: string } | { ok: false; reason: string };

interface Gpu {
  device: GpuDevice;
  name: string;
  lost: boolean;
  pipeline: Promise<GpuComputePipeline> | null;
  /// Failed CPU checks on this device since its last passed self-test; a new device starts clean.
  strikes: number;
}

interface HitRecord {
  batch: number;
  index: number;
  hi: number;
  lo: number;
}

interface Dispatch {
  ms: number;
  hits: number;
  records: HitRecord[];
  sample: Uint8Array;
}

/// A mining dispatch on its way: the nonce head, batch and size its hits are checked against.
interface Flight {
  high: Uint8Array;
  batch: number;
  threads: number;
  result: Promise<Dispatch>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

/// Yields to the event loop without a timer, so a hidden tab's timer throttling does not slow the loop.
function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      resolve();
    };
    ch.port2.postMessage(null);
  });
}

// The duty cycle's rest, timed by a tiny worker (rest.worker.ts): a hidden tab's own timers fire about
// once a second, which would leave the GPU nearly idle below 100% power. The page's timer is the fallback.
// The worker is a bounded singleton: one for the page, made at the first rest, idle between rests, and
// never ended on stop, since a rest still pending then would leave its loop waiting for good.
let clock: Worker | null | undefined;
let clockSeq = 0;
const resting = new Map<number, () => void>();

function rest(ms: number): Promise<void> {
  if (clock === undefined) {
    try {
      const w = new Worker(new URL("./rest.worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (e: MessageEvent<number>) => {
        resting.get(e.data)?.();
        resting.delete(e.data);
      };
      w.onerror = () => {
        clock = null;
        for (const wake of resting.values()) wake();
        resting.clear();
      };
      clock = w;
    } catch {
      clock = null;
    }
  }
  if (!clock) return sleep(ms);
  const id = ++clockSeq;
  const w = clock;
  return new Promise((resolve) => {
    resting.set(id, resolve);
    w.postMessage({ id, ms });
  });
}

function adapt(threads: number, ms: number, [grow, shrink]: Band): number {
  if (ms < grow && threads < MAX_THREADS) return threads * 2;
  if (ms > shrink && threads > MIN_THREADS) return threads / 2;
  return threads;
}

/// The band for the next mining dispatch: frame-sized while the page is seen and the GPU runs at full power.
function band(power: Power): Band {
  const seen = typeof document === "undefined" || document.visibilityState === "visible";
  return FRAME_SIZED && seen && power >= 100 ? FRAME_MS : LONG_MS;
}

function api(): GpuApi | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { gpu?: GpuApi }).gpu;
}

const VENDORS: Record<string, string> = { nvidia: "NVIDIA", amd: "AMD", intel: "Intel", apple: "Apple", qualcomm: "Qualcomm", arm: "Arm", microsoft: "Microsoft" };

async function nameOf(adapter: GpuAdapter): Promise<string> {
  let info = adapter.info;
  if (!info && adapter.requestAdapterInfo) info = await adapter.requestAdapterInfo().catch(() => undefined);
  const description = info?.description?.trim();
  if (description) return description;
  const vendor = info?.vendor?.trim() ?? "";
  const arch = info?.architecture?.trim() ?? "";
  const parts = [VENDORS[vendor.toLowerCase()] ?? vendor, arch ? arch[0].toUpperCase() + arch.slice(1) : ""].filter(Boolean);
  return parts.length ? parts.join(" ") : "WebGPU adapter";
}

async function requestAdapter(): Promise<GpuAdapter> {
  const gpu = api();
  if (!gpu) throw new Error("This browser has no WebGPU.");
  const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("WebGPU found no GPU adapter.");
  return adapter;
}

// The one device the self-test and the miner share, requested at the first self-test from an adapter of
// its own (an adapter gives one device). A lost device is forgotten, so the next call asks for a new
// adapter and device, and the listeners hear of the loss.
let shared: Promise<Gpu> | null = null;
const lostListeners = new Set<(message: string) => void>();

function acquire(): Promise<Gpu> {
  if (shared) return shared;
  const p: Promise<Gpu> = (async () => {
    const adapter = await requestAdapter();
    const device = await adapter.requestDevice({ label: "pupate miner" });
    const g: Gpu = { device, name: await nameOf(adapter), lost: false, pipeline: null, strikes: 0 };
    void device.lost.then((info) => {
      g.lost = true;
      if (shared === p) shared = null;
      if (info.reason !== "destroyed") for (const l of lostListeners) l(info.message || "the device was lost");
    });
    return g;
  })();
  shared = p;
  p.catch(() => {
    if (shared === p) shared = null;
  });
  return p;
}

function pipelineOf(g: Gpu): Promise<GpuComputePipeline> {
  if (g.pipeline) return g.pipeline;
  const p = (async () => {
    const module = g.device.createShaderModule({ label: "keccak", code: KECCAK_WGSL });
    const info = await module.getCompilationInfo();
    const err = info.messages.find((m) => m.type === "error");
    if (err) throw new Error(`the shader did not compile: ${err.message} (line ${err.lineNum})`);
    return g.device.createComputePipelineAsync({ label: "keccak", layout: "auto", compute: { module, entryPoint: "main" } });
  })();
  g.pipeline = p;
  p.catch(() => {
    if (g.pipeline === p) g.pipeline = null;
  });
  return p;
}

/// The pipeline with its buffers: the uniform, the output the shader writes, and two buffers to read it
/// back, so one dispatch can run while the one before it is read.
class Kernel {
  private readonly g: Gpu;
  private readonly pipeline: GpuComputePipeline;
  private readonly params: GpuBuffer;
  private readonly out: GpuBuffer;
  private readonly readbacks: GpuBuffer[];
  private readonly bind: GpuBindGroup;
  private readonly size: number;
  private turn = 0;
  /// When the last dispatch finished: one that queued behind it is timed from then.
  private lastDone = 0;
  readonly slots: number;

  private constructor(g: Gpu, pipeline: GpuComputePipeline, slots: number) {
    const { device } = g;
    this.g = g;
    this.pipeline = pipeline;
    this.slots = slots;
    this.size = OUT_HEAD + 16 * slots;
    this.params = device.createBuffer({ label: "miner params", size: PARAM_WORDS * 4, usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST });
    this.out = device.createBuffer({ label: "miner out", size: this.size, usage: BufferUsage.STORAGE | BufferUsage.COPY_SRC | BufferUsage.COPY_DST });
    this.readbacks = [0, 1].map((i) => device.createBuffer({ label: `miner readback ${i}`, size: this.size, usage: BufferUsage.MAP_READ | BufferUsage.COPY_DST }));
    this.bind = device.createBindGroup({
      label: "miner",
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.params } },
        { binding: 1, resource: { buffer: this.out } },
      ],
    });
  }

  static async create(g: Gpu, slots: number): Promise<Kernel> {
    const pipeline = await pipelineOf(g);
    g.device.pushErrorScope("validation");
    const k = new Kernel(g, pipeline, slots);
    const err = await g.device.popErrorScope();
    if (err) {
      k.destroy();
      throw new Error(`the GPU refused the miner's buffers: ${err.message}`);
    }
    return k;
  }

  /// One dispatch of `threads` threads (a multiple of the workgroup size), timed by the GPU's work. Two can
  /// be in flight: the queue runs them in order (the uniform and the output are written in queue order
  /// too), and each reads back into a buffer of its own. A third must wait until the first was read.
  async run(words: Uint32Array, threads: number): Promise<Dispatch> {
    const { device } = this.g;
    const readback = this.readbacks[this.turn];
    this.turn ^= 1;
    device.queue.writeBuffer(this.params, 0, words);
    const enc = device.createCommandEncoder({ label: "miner" });
    enc.clearBuffer(this.out, 0, 16);
    const pass = enc.beginComputePass({ label: "keccak" });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bind);
    pass.dispatchWorkgroups(threads / WORKGROUP_SIZE);
    pass.end();
    enc.copyBufferToBuffer(this.out, 0, readback, 0, this.size);
    const t0 = performance.now();
    device.queue.submit([enc.finish()]);
    // Ask for the map at once: it resolves right after the work does, which saves a round trip (about
    // 5% of the rate on a GPU whose dispatches take 10 ms). A failed map surfaces at `await mapped`; the
    // empty catch only keeps it from counting as unhandled if the wait for the work throws first.
    const mapped = readback.mapAsync(MapMode.READ);
    mapped.catch(() => {});
    await device.queue.onSubmittedWorkDone();
    const done = performance.now();
    // From the submit, or from the end of the dispatch this one queued behind.
    const ms = done - Math.max(t0, this.lastDone);
    this.lastDone = done;
    await mapped;
    const u = new Uint32Array(readback.getMappedRange().slice(0));
    readback.unmap();
    const hits = u[0];
    const records: HitRecord[] = [];
    for (let i = 0; i < Math.min(hits, this.slots); i++) {
      const o = OUT_HEAD / 4 + 4 * i;
      records.push({ batch: u[o], index: u[o + 1], hi: u[o + 2], lo: u[o + 3] });
    }
    return { ms, hits, records, sample: new Uint8Array(u.buffer, 16, 32) };
  }

  destroy(): void {
    this.params.destroy();
    this.out.destroy();
    for (const b of this.readbacks) b.destroy();
  }
}

/// A hit record checked on the CPU: the nonce it names, re-hashed, must give the GPU's words and meet the target.
function verify(job: MinerJob, high: Uint8Array, batch: number, threads: number, rec: HitRecord): { ok: boolean; nonce: Uint8Array; digest: Uint8Array } {
  const nonce = gpuNonce(high, rec.batch, rec.index);
  const digest = keccak_256(preimage(job, nonce));
  const w = digestWords(digest);
  const ok = rec.batch === batch && rec.index < threads && w.hi === rec.hi && w.lo === rec.lo && below(w.hi, w.lo, job.targetHi, job.targetLo);
  return { ok, nonce, digest };
}

// The self-test's fixed job: the contract's real domain, fixed words elsewhere, and a fixed nonce head.
const KAT_JOB: MinerJob = {
  id: 0,
  domain: bytesHex(keccak_256(new TextEncoder().encode("Metamorph MD work v1"))),
  chainId: 1,
  contract: "0x5fbdb2315678afecb367f032d93f642f64180aa3",
  folded: "0x0123456789abcdeffedcba98765432100f1e2d3c4b5a69788796a5b4c3d2e1f0",
  miner: "0xc0ffee254729296a45a3885639ac7e10f9d54979",
  ...targetWords(64),
  bits: 64,
};
const KAT_HIGH = hexBytes("0x000102030405060708090a0b0c0d0e0f1011121314151617");
const KAT_BATCH = 0x123456;
const HIT_BATCH = 0xabcdef;

export class GpuMiner {
  private gen = 0;
  private power: Power = 100;
  private queue: Promise<void> = Promise.resolve();

  /// Whether this browser can mine on a GPU: WebGPU and an adapter, whose info names it. No device is
  /// requested here; the first self-test asks for one.
  static async probe(): Promise<Probe> {
    try {
      return { ok: true, name: await nameOf(await requestAdapter()) };
    } catch (e) {
      return { ok: false, reason: message(e) };
    }
  }

  /// Hears of a lost device (not one the page let go); returns the unsubscribe.
  static onLost(listener: (message: string) => void): () => void {
    lostListeners.add(listener);
    return () => {
      lostListeners.delete(listener);
    };
  }

  /// Runs before the first job; `benchMs` is the benchmark's length (one second on the page).
  static async selfTest(benchMs = 1000): Promise<GpuSelfTest> {
    const t: GpuSelfTest = { ok: false, name: "", rate: 0, detail: "", batch: 0, dispatchMs: 0, dispatches: 0, compileMs: 0 };
    const kernels: Kernel[] = [];
    try {
      const g = await acquire();
      t.name = g.name;
      const c0 = performance.now();
      await pipelineOf(g);
      t.compileMs = Math.round(performance.now() - c0);

      // (a) The known answer: one workgroup at an unreachable difficulty; thread 0 hashes the fixed nonce.
      const one = await Kernel.create(g, HIT_SLOTS);
      kernels.push(one);
      const a = await one.run(paramWords(midstate(KAT_JOB), blockTwo(KAT_JOB, KAT_HIGH, KAT_BATCH), KAT_JOB, KAT_BATCH), WORKGROUP_SIZE);
      const want = keccak_256(preimage(KAT_JOB, gpuNonce(KAT_HIGH, KAT_BATCH, 0)));
      if (bytesHex(a.sample) !== bytesHex(want)) {
        t.detail = `known answer: the GPU's digest ${bytesHex(a.sample).slice(0, 18)}… is not the CPU's ${bytesHex(want).slice(0, 18)}…`;
        return t;
      }
      if (a.hits !== 0) {
        t.detail = `known answer: ${a.hits} hits where none is possible`;
        return t;
      }

      // (b) The hit path: at bits 0 every thread hits; every record must verify on the CPU, once each.
      const all = await Kernel.create(g, WORKGROUP_SIZE);
      kernels.push(all);
      const job: MinerJob = { ...KAT_JOB, ...targetWords(0), bits: 0 };
      const high = randomBytes(NONCE_HIGH_BYTES);
      const b = await all.run(paramWords(midstate(job), blockTwo(job, high, HIT_BATCH), job, HIT_BATCH), WORKGROUP_SIZE);
      if (b.hits !== WORKGROUP_SIZE) {
        t.detail = `hit path: ${b.hits} of ${WORKGROUP_SIZE} threads reported a hit at bits 0`;
        return t;
      }
      const seen = new Set<number>();
      for (const rec of b.records) {
        if (seen.has(rec.index) || !verify(job, high, HIT_BATCH, WORKGROUP_SIZE, rec).ok) {
          t.detail = `hit path: thread ${rec.index}'s hit failed CPU verification`;
          return t;
        }
        seen.add(rec.index);
      }
      if (seen.size !== WORKGROUP_SIZE) {
        t.detail = `hit path: ${seen.size} of ${WORKGROUP_SIZE} hits recorded`;
        return t;
      }

      // (c) One second of work at an unreachable difficulty, after a dispatch to warm up.
      const bench = await benchmark(one, benchMs);
      Object.assign(t, bench);
      t.ok = true;
      // A device that passes starts with a clean record.
      g.strikes = 0;
      t.detail = `known answer matches the CPU; ${WORKGROUP_SIZE} of ${WORKGROUP_SIZE} hits verified on the CPU; ${bench.dispatches} dispatches of up to ${bench.batch} hashes in ${benchMs / 1000} s`;
      return t;
    } catch (e) {
      t.detail = message(e);
      return t;
    } finally {
      for (const k of kernels) k.destroy();
    }
  }

  /// Mines `job` until stopped or handed another job; one run at a time, in order.
  start(job: MinerJob, opts: GpuStartOptions): void {
    const gen = ++this.gen;
    this.power = opts.power;
    this.queue = this.queue.then(() => this.run(job, gen, opts)).catch((e) => this.fail(gen, opts, `GPU stopped: ${message(e)}`, "error"));
  }

  stop(): void {
    this.gen++;
  }

  setPower(p: Power): void {
    this.power = p;
  }

  private fail(gen: number, opts: GpuStartOptions, reason: string, kind: GpuFailure): void {
    if (gen !== this.gen) return;
    this.gen++;
    opts.onFail(reason, kind);
  }

  private async run(job: MinerJob, gen: number, opts: GpuStartOptions): Promise<void> {
    if (gen !== this.gen) return;
    let g: Gpu;
    let k: Kernel;
    try {
      g = await acquire();
      k = await Kernel.create(g, HIT_SLOTS);
    } catch (e) {
      this.fail(gen, opts, `GPU stopped: ${message(e)}`, "error");
      return;
    }
    // A hit or a sample that failed the CPU check counts against the device; its third strike stops the engine.
    const strike = (what: string) => {
      g.strikes++;
      opts.onLog(`${what} failed CPU verification (${g.strikes} of ${MAX_STRIKES})`);
      if (g.strikes >= MAX_STRIKES) this.fail(gen, opts, `GPU failed CPU verification ${MAX_STRIKES} times`, "verify");
    };
    // Dispatches in flight, oldest first.
    const flights: Flight[] = [];
    try {
      const mid = midstate(job);
      let high = randomBytes(NONCE_HIGH_BYTES);
      let batch = 0;
      let threads = START_THREADS;
      let checkedAt = -Infinity;
      const launch = () => {
        const result = k.run(paramWords(mid, blockTwo(job, high, batch), job, batch), threads);
        result.catch(() => {}); // awaited in its turn, or let land in the finally
        flights.push({ high, batch, threads, result });
        if (++batch >= BATCH_LIMIT) {
          high = randomBytes(NONCE_HIGH_BYTES);
          batch = 0;
        }
      };
      while (gen === this.gen) {
        if (g.lost) throw new Error("the device was lost");
        // At full power a second dispatch waits on the GPU while the host reads the first back.
        while (flights.length < (this.power >= 100 ? IN_FLIGHT : 1)) launch();
        const f = flights.shift()!;
        const r = await f.result;
        if (gen !== this.gen) break;
        const sample = bytesHex(r.sample);
        opts.onProgress({ jobId: job.id, hashes: f.threads, sample });
        // The first dispatch of a job, then every few seconds: thread 0's nonce re-hashed on the CPU.
        const now = performance.now();
        if (now - checkedAt >= SAMPLE_CHECK_MS) {
          checkedAt = now;
          if (bytesHex(keccak_256(preimage(job, gpuNonce(f.high, f.batch, 0)))) !== sample) strike("GPU sample");
        }
        for (const rec of r.records) {
          if (gen !== this.gen) break;
          const v = verify(job, f.high, f.batch, f.threads, rec);
          if (v.ok) {
            opts.onFound({ jobId: job.id, nonce: bytesHex(v.nonce), digest: bytesHex(v.digest) });
            continue;
          }
          strike("GPU hit");
        }
        threads = adapt(threads, r.ms, band(this.power));
        // Rest for the duty cycle, and always yield so stop, power and new jobs get through.
        const pause = this.power >= 100 ? 0 : (r.ms * (100 - this.power)) / this.power;
        await (pause > 0 ? rest(pause) : nextTask());
      }
    } catch (e) {
      this.fail(gen, opts, g.lost ? `GPU lost: ${message(e)}` : `GPU stopped: ${message(e)}`, g.lost ? "lost" : "error");
    } finally {
      // A dispatch still in flight reads back into the kernel's buffers: let it land before they go.
      await Promise.allSettled(flights.map((f) => f.result));
      k.destroy();
    }
  }
}

/// Mining dispatches at an unreachable difficulty for `ms` after a warm-up dispatch; nothing may hit.
async function benchmark(k: Kernel, ms: number): Promise<Pick<GpuSelfTest, "rate" | "batch" | "dispatchMs" | "dispatches">> {
  const job: MinerJob = { ...KAT_JOB, ...targetWords(64), bits: 64 };
  const mid = midstate(job);
  const high = randomBytes(NONCE_HIGH_BYTES);
  let batch = 0;
  let threads = START_THREADS;
  const step = async () => {
    const used = threads;
    const r = await k.run(paramWords(mid, blockTwo(job, high, batch), job, batch), used);
    if (r.hits) throw new Error(`benchmark: ${r.hits} hits where none is possible`);
    batch++;
    // The benchmark keeps the first version's policy: one dispatch at a time, within 60..120 ms.
    threads = adapt(threads, r.ms, LONG_MS);
    await nextTask();
    return { used, ms: r.ms };
  };
  await step();
  let hashes = 0;
  let dispatches = 0;
  let last = { used: threads, ms: 0 };
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    last = await step();
    hashes += last.used;
    dispatches++;
  }
  const seconds = (performance.now() - t0) / 1000;
  return { rate: hashes / seconds, batch: last.used, dispatchMs: Math.round(last.ms * 10) / 10, dispatches };
}
