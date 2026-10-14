// The GPU engine: one WebGPU device, the unrolled keccak shader (keccak.ts), and a dispatch loop that
// gives every thread one nonce. The host keeps the midstate and the nonce bookkeeping (words.ts). After
// each dispatch it reads back a small buffer (the hit count, up to 16 hit records, thread 0's digest for
// the drawing), rebuilds each hit's nonce, re-hashes the 192-byte preimage on the CPU with keccak_256 and
// only then reports it. A hit that fails that check is logged; the third one stops the engine.
//
// The batch adapts to the GPU: it starts at 2^18 threads, doubles while a dispatch takes under 60 ms,
// halves past 120 ms, and stays within 2^14..2^22. Power is a duty cycle, as on the CPU: after a dispatch
// that took t ms the loop rests t × (100 − power) / power ms, and it always yields between dispatches.
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
const MIN_THREADS = 1 << 14;
const MAX_THREADS = 1 << 22;
const GROW_BELOW_MS = 60;
const SHRINK_ABOVE_MS = 120;
/// Hit records a mining dispatch keeps; more hits than this in one dispatch are counted, not recorded.
const HIT_SLOTS = 16;
const MAX_FAILED_HITS = 3;
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

function adapt(threads: number, ms: number): number {
  if (ms < GROW_BELOW_MS && threads < MAX_THREADS) return threads * 2;
  if (ms > SHRINK_ABOVE_MS && threads > MIN_THREADS) return threads / 2;
  return threads;
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

// The one device the probe, the self-test and the miner share. A lost device is forgotten, so the next
// call asks for a new one, and the listeners hear of the loss.
let shared: Promise<Gpu> | null = null;
const lostListeners = new Set<(message: string) => void>();

function acquire(): Promise<Gpu> {
  if (shared) return shared;
  const p: Promise<Gpu> = (async () => {
    const gpu = api();
    if (!gpu) throw new Error("This browser has no WebGPU.");
    const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("WebGPU found no GPU adapter.");
    const device = await adapter.requestDevice({ label: "pupate miner" });
    const g: Gpu = { device, name: await nameOf(adapter), lost: false, pipeline: null };
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

/// The pipeline with its buffers: the uniform, the output the shader writes, and a buffer to read it back.
class Kernel {
  private readonly g: Gpu;
  private readonly pipeline: GpuComputePipeline;
  private readonly params: GpuBuffer;
  private readonly out: GpuBuffer;
  private readonly readback: GpuBuffer;
  private readonly bind: GpuBindGroup;
  private readonly size: number;
  readonly slots: number;

  private constructor(g: Gpu, pipeline: GpuComputePipeline, slots: number) {
    const { device } = g;
    this.g = g;
    this.pipeline = pipeline;
    this.slots = slots;
    this.size = OUT_HEAD + 16 * slots;
    this.params = device.createBuffer({ label: "miner params", size: PARAM_WORDS * 4, usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST });
    this.out = device.createBuffer({ label: "miner out", size: this.size, usage: BufferUsage.STORAGE | BufferUsage.COPY_SRC | BufferUsage.COPY_DST });
    this.readback = device.createBuffer({ label: "miner readback", size: this.size, usage: BufferUsage.MAP_READ | BufferUsage.COPY_DST });
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

  /// One dispatch of `threads` threads (a multiple of the workgroup size), timed to the queue's completion.
  async run(words: Uint32Array, threads: number): Promise<Dispatch> {
    const { device } = this.g;
    device.queue.writeBuffer(this.params, 0, words);
    const enc = device.createCommandEncoder({ label: "miner" });
    enc.clearBuffer(this.out, 0, 16);
    const pass = enc.beginComputePass({ label: "keccak" });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bind);
    pass.dispatchWorkgroups(threads / WORKGROUP_SIZE);
    pass.end();
    enc.copyBufferToBuffer(this.out, 0, this.readback, 0, this.size);
    const t0 = performance.now();
    device.queue.submit([enc.finish()]);
    // Ask for the map at once: it resolves right after the work does, which saves a round trip (about
    // 5% of the rate on a GPU whose dispatches take 10 ms). A failed map surfaces at `await mapped`; the
    // empty catch only keeps it from counting as unhandled if the wait for the work throws first.
    const mapped = this.readback.mapAsync(MapMode.READ);
    mapped.catch(() => {});
    await device.queue.onSubmittedWorkDone();
    const ms = performance.now() - t0;
    await mapped;
    const u = new Uint32Array(this.readback.getMappedRange().slice(0));
    this.readback.unmap();
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
    this.readback.destroy();
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
  private failedHits = 0;

  /// Whether this browser can mine on a GPU: WebGPU, an adapter, and a device.
  static async probe(): Promise<Probe> {
    if (!api()) return { ok: false, reason: "This browser has no WebGPU." };
    try {
      const g = await acquire();
      return { ok: true, name: g.name };
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
    try {
      const mid = midstate(job);
      let high = randomBytes(NONCE_HIGH_BYTES);
      let batch = 0;
      let threads = START_THREADS;
      while (gen === this.gen) {
        if (g.lost) throw new Error("the device was lost");
        const r = await k.run(paramWords(mid, blockTwo(job, high, batch), job, batch), threads);
        if (gen !== this.gen) break;
        opts.onProgress({ jobId: job.id, hashes: threads, sample: bytesHex(r.sample) });
        for (const rec of r.records) {
          if (gen !== this.gen) break;
          const v = verify(job, high, batch, threads, rec);
          if (v.ok) {
            opts.onFound({ jobId: job.id, nonce: bytesHex(v.nonce), digest: bytesHex(v.digest) });
            continue;
          }
          this.failedHits++;
          opts.onLog(`GPU hit failed CPU verification (${this.failedHits} of ${MAX_FAILED_HITS})`);
          if (this.failedHits >= MAX_FAILED_HITS) this.fail(gen, opts, `GPU hits failed CPU verification ${MAX_FAILED_HITS} times`, "verify");
        }
        threads = adapt(threads, r.ms);
        if (++batch >= BATCH_LIMIT) {
          high = randomBytes(NONCE_HIGH_BYTES);
          batch = 0;
        }
        // Rest for the duty cycle, and always yield so stop, power and new jobs get through.
        const pause = this.power >= 100 ? 0 : (r.ms * (100 - this.power)) / this.power;
        await (pause > 0 ? rest(pause) : nextTask());
      }
    } catch (e) {
      this.fail(gen, opts, g.lost ? `GPU lost: ${message(e)}` : `GPU stopped: ${message(e)}`, g.lost ? "lost" : "error");
    } finally {
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
    threads = adapt(threads, r.ms);
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
