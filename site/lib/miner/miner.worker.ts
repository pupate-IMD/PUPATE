// One mining thread. Builds the 192-byte preimage once, then grinds the last eight bytes of the nonce
// in chunks, reporting its count and a sample digest (for the drawing) after each chunk and any hit at
// once. Power is a duty cycle: a thread at 25% rests three times as long as it works.
import { keccak_256 } from "@noble/hashes/sha3";
import type { FromWorker, Power, StartMessage, ToWorker } from "./job";

const ctx = self as unknown as { postMessage: (m: FromWorker) => void; onmessage: ((e: MessageEvent<ToWorker>) => void) | null };

let generation = 0;
let power: Power = 100;

ctx.onmessage = (e) => {
  const m = e.data;
  if (m.type === "stop") generation++;
  else if (m.type === "power") power = m.power;
  else if (m.type === "start") {
    generation++;
    power = m.power;
    void run(m, generation);
  }
};

function hexToBytes(hex: string): Uint8Array {
  const h = hex.replace(/^0x/, "");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}
const toHex = (b: Uint8Array) => ("0x" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")) as `0x${string}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function run(m: StartMessage, mine: number) {
  const { job } = m;
  const buf = new Uint8Array(192);
  buf.set(hexToBytes(job.domain), 0);
  // chainId as uint256
  let c = job.chainId;
  for (let i = 63; i >= 32 && c > 0; i--) {
    buf[i] = c & 255;
    c = Math.floor(c / 256);
  }
  buf.set(hexToBytes(job.contract), 64 + 12);
  buf.set(hexToBytes(job.folded), 96);
  buf.set(hexToBytes(job.miner), 128 + 12);
  buf.set(hexToBytes(m.nonceHigh), 160);
  const nonce = buf.subarray(160, 192);
  // The worker's own lane: byte 24 of the nonce, so threads never overlap; the last 7 bytes count. The
  // page runs at most 255 workers (MAX_CPU_THREADS in useMiner.ts), so CPU lanes stay within 0..254 and
  // 0xff stays the GPU's.
  nonce[24] = m.worker & 255;
  for (let i = 25; i < 32; i++) nonce[i] = 0;
  const { targetHi, targetLo } = job;

  while (generation === mine) {
    const t0 = performance.now();
    let last: Uint8Array | null = null;
    for (let i = 0; i < m.chunk; i++) {
      let k = 31;
      while (k >= 25) {
        nonce[k] = (nonce[k] + 1) & 255;
        if (nonce[k] !== 0) break;
        k--;
      }
      const h = keccak_256(buf);
      last = h;
      const hi = ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
      if (hi < targetHi || (hi === targetHi && ((h[4] << 24) | (h[5] << 16) | (h[6] << 8) | h[7]) >>> 0 < targetLo)) {
        ctx.postMessage({ type: "found", worker: m.worker, jobId: job.id, nonce: toHex(nonce), digest: toHex(h) });
      }
    }
    const took = performance.now() - t0;
    ctx.postMessage({ type: "progress", worker: m.worker, jobId: job.id, hashes: m.chunk, sample: last ? toHex(last) : "0x" });
    // Rest for the duty cycle, and always yield so stop and power messages get through.
    const rest = power >= 100 ? 0 : (took * (100 - power)) / power;
    await sleep(rest);
  }
}
