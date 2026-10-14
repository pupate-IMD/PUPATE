// The GPU engine's bytes and words, on the CPU: the 192-byte preimage, the GPU's nonce layout, the
// midstate of the first block, the second block's fixed words, the uniform the shader reads, and a CPU
// model of what one shader thread computes (for the known-answer checks).
//
// Keccak-256 absorbs 136 bytes a block, so the preimage is two blocks: bytes 0..135 (domain, chain id,
// contract, folded word, the miner word's first 8 bytes) never change within a job and become the
// midstate; bytes 136..191 (the rest of the miner word, the nonce) plus the padding are the second block.
//
// The GPU nonce: bytes 0..23 are random per job, byte 24 is 0xff (the GPU's lane; the CPU threads use
// 0..n-1 there, so the two never overlap), bytes 25..27 are the dispatch counter and 28..31 the thread's
// global index, both big-endian.
//
// No relative runtime imports: node runs this file directly for the known-answer checks.
import { keccakP } from "@noble/hashes/sha3";
import type { Hex } from "viem";
import type { MinerJob } from "../job";

type JobWords = Pick<MinerJob, "domain" | "chainId" | "contract" | "folded" | "miner">;

/// Keccak-256's rate: the bytes one block absorbs.
export const RATE = 136;
/// Random bytes at the head of every GPU nonce, fresh per job.
export const NONCE_HIGH_BYTES = 24;
/// Nonce byte 24 on the GPU; CPU threads write their index (0..n-1) there.
export const GPU_LANE = 0xff;
/// The dispatch counter has three bytes; past it, the job takes fresh random bytes and counts again.
export const BATCH_LIMIT = 1 << 24;
/// Words in the uniform: the midstate (50, padded to 52), block two (13, padded to 16), then the run
/// (target hi, target lo, batch, unused).
export const PARAM_WORDS = 72;

export function hexBytes(hex: string): Uint8Array {
  const s = hex.replace(/^0x/, "");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesHex(b: Uint8Array): Hex {
  let s = "0x";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s as Hex;
}

export function bswap32(x: number): number {
  return (((x & 0xff) << 24) | ((x & 0xff00) << 8) | ((x >>> 8) & 0xff00) | (x >>> 24)) >>> 0;
}

const le32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/// abi.encode(DOMAIN, chainId, contract, folded, miner, nonce): six 32-byte words.
export function preimage(job: JobWords, nonce: Uint8Array): Uint8Array {
  const buf = new Uint8Array(192);
  buf.set(hexBytes(job.domain), 0);
  let c = job.chainId;
  for (let i = 63; i >= 32 && c > 0; i--) {
    buf[i] = c % 256;
    c = Math.floor(c / 256);
  }
  buf.set(hexBytes(job.contract), 64 + 12);
  buf.set(hexBytes(job.folded), 96);
  buf.set(hexBytes(job.miner), 128 + 12);
  buf.set(nonce, 160);
  return buf;
}

/// The nonce GPU thread `index` of dispatch `batch` tries.
export function gpuNonce(high: Uint8Array, batch: number, index: number): Uint8Array {
  const n = new Uint8Array(32);
  n.set(high.subarray(0, NONCE_HIGH_BYTES), 0);
  n[24] = GPU_LANE;
  n[25] = (batch >>> 16) & 255;
  n[26] = (batch >>> 8) & 255;
  n[27] = batch & 255;
  n[28] = (index >>> 24) & 255;
  n[29] = (index >>> 16) & 255;
  n[30] = (index >>> 8) & 255;
  n[31] = index & 255;
  return n;
}

/// The state after absorbing the first block: 50 words, lane i = (word 2i lo, word 2i + 1 hi).
export function midstate(job: JobWords): Uint32Array {
  const pre = preimage(job, new Uint8Array(32)); // the nonce lies past the first block
  const s = new Uint32Array(50);
  for (let w = 0; w < RATE / 4; w++) s[w] = le32(pre, 4 * w);
  keccakP(s, 24);
  return s;
}

/// Block two's words the whole dispatch shares: preimage bytes 136..187 as little-endian words (the
/// miner word's tail, then nonce bytes 0..27, which end with the GPU lane and the batch).
export function blockTwo(job: JobWords, high: Uint8Array, batch: number): Uint32Array {
  const pre = preimage(job, gpuNonce(high, batch, 0)); // the thread index lies in bytes 188..191
  const w = new Uint32Array(13);
  for (let k = 0; k < 13; k++) w[k] = le32(pre, RATE + 4 * k);
  return w;
}

/// The uniform for one dispatch.
export function paramWords(mid: Uint32Array, blk: Uint32Array, job: Pick<MinerJob, "targetHi" | "targetLo">, batch: number): Uint32Array {
  const p = new Uint32Array(PARAM_WORDS);
  p.set(mid, 0);
  p.set(blk, 52);
  p[68] = job.targetHi >>> 0;
  p[69] = job.targetLo >>> 0;
  p[70] = batch >>> 0;
  return p;
}

/// A digest's first eight bytes as the two big-endian words the target is compared with.
export function digestWords(d: Uint8Array): { hi: number; lo: number } {
  return {
    hi: ((d[0] << 24) | (d[1] << 16) | (d[2] << 8) | d[3]) >>> 0,
    lo: ((d[4] << 24) | (d[5] << 16) | (d[6] << 8) | d[7]) >>> 0,
  };
}

/// The two-word compare the shader and the CPU threads both make.
export function below(hi: number, lo: number, targetHi: number, targetLo: number): boolean {
  return hi < targetHi || (hi === targetHi && lo < targetLo);
}

/// What shader thread `index` computes, on the CPU: the midstate XOR block two, the thread's index in
/// bytes 188..191, the padding, one permutation, the first 32 bytes out.
export function modelDigest(mid: Uint32Array, blk: Uint32Array, index: number, permute: (s: Uint32Array) => void): Uint8Array {
  const s = Uint32Array.from(mid);
  for (let k = 0; k < 13; k++) s[k] ^= blk[k];
  s[13] ^= bswap32(index);
  s[14] ^= 0x01; // keccak padding: 0x01 right after the message (block byte 56) ...
  s[33] ^= 0x80000000; // ... and 0x80 in the block's last byte (135)
  permute(s);
  const out = new Uint8Array(32);
  for (let w = 0; w < 8; w++) {
    out[4 * w] = s[w] & 255;
    out[4 * w + 1] = (s[w] >>> 8) & 255;
    out[4 * w + 2] = (s[w] >>> 16) & 255;
    out[4 * w + 3] = s[w] >>> 24;
  }
  return out;
}
