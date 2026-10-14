// The mining job as the page and the workers share it. The preimage is the spec's 192 bytes:
//   keccak256(abi.encode(DOMAIN, chainId, contract, keccak256(abi.encode(anchorHash, prevWork)), miner, nonce))
// Live, every field comes from the contract (lib/metamorph/job.ts builds the job); in a practice run they
// are random, the target is the practice target, and a found hash mints nothing.
import type { Hex } from "viem";

export interface MinerJob {
  id: number;
  domain: Hex;
  chainId: number;
  contract: Hex;
  /// keccak256(abi.encode(anchorHash, prevWork)), already folded into one word.
  folded: Hex;
  miner: Hex;
  /// The target's top 64 bits as two uint32 words; a digest wins when its first two words are below them.
  targetHi: number;
  targetLo: number;
  /// The leading zero bits the target asks for. The page shows it, and a practice run tells a gilt hash by
  /// it (4 more); live, gilt is read from the mint's receipt.
  bits: number;
  /// A job from the contract, whose finds are sent as mints. A practice job says false, and its finds are
  /// never sent anywhere.
  live?: boolean;
}

export type Power = 25 | 50 | 75 | 100;
export type Engine = "cpu" | "gpu";

export interface StartMessage {
  type: "start";
  job: MinerJob;
  /// 32 random bytes; the worker counts in the last eight.
  nonceHigh: Hex;
  power: Power;
  worker: number;
  /// Hashes per batch between progress reports.
  chunk: number;
}
export type ToWorker = StartMessage | { type: "stop" } | { type: "power"; power: Power };
export type FromWorker =
  | { type: "progress"; worker: number; jobId: number; hashes: number; sample: Hex }
  | { type: "found"; worker: number; jobId: number; nonce: Hex; digest: Hex };

/// A valid practice hash on the CPU needs this many leading zero bits: about a million hashes on average.
export const PRACTICE_BITS = 20;

/// The GPU's practice target: the bits that make a hash take about four seconds at the rate its
/// self-test measured, within 20..40.
export function practiceBitsFor(rate: number): number {
  if (!(rate > 0)) return PRACTICE_BITS;
  return Math.min(40, Math.max(20, Math.round(Math.log2(rate * 4))));
}

/// The mainnet floor the spec names for epoch 1, shown on the page before the contracts exist.
export const EPOCH_ONE_BITS = 20;

export function randomHex(bytes: number): Hex {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return ("0x" + Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("")) as Hex;
}

/// The two target words for `bits` leading zeros: target = 2^256 >> bits, top 64 bits.
export function targetWords(bits: number): { targetHi: number; targetLo: number } {
  if (bits <= 0) return { targetHi: 0xffffffff, targetLo: 0xffffffff };
  if (bits >= 64) return { targetHi: 0, targetLo: 0 };
  const top = (1n << 64n) >> BigInt(bits);
  return { targetHi: Number(top >> 32n), targetLo: Number(top & 0xffffffffn) };
}

/// The two target words of a uint256 target: its top 64 bits. A digest whose first eight bytes are below
/// them is below the target whatever its other 24 bytes, so the engines' two-word compare never passes a
/// hash the contract refuses; it passes over only digests whose top 64 bits equal the target's (one hash
/// in 2^64 at most).
export function targetWordsFrom(target: bigint): { targetHi: number; targetLo: number } {
  if (target < 0n || target >> 256n !== 0n) throw new RangeError("not a uint256");
  const top = target >> 192n;
  return { targetHi: Number(top >> 32n), targetLo: Number(top & 0xffffffffn) };
}

export function practiceJob(id: number, miner?: Hex, bits: number = PRACTICE_BITS): MinerJob {
  return {
    id,
    domain: randomHex(32),
    chainId: 1,
    contract: randomHex(20),
    folded: randomHex(32),
    miner: miner ?? randomHex(20),
    ...targetWords(bits),
    bits,
    live: false,
  };
}

/// Leading zero bits a digest has, from its hex; the page uses it to tell a gilt hash (4 more than needed).
export function leadingZeroBits(digest: Hex): number {
  const h = digest.slice(2);
  let bits = 0;
  for (const ch of h) {
    const v = parseInt(ch, 16);
    if (v === 0) {
      bits += 4;
      continue;
    }
    bits += v < 2 ? 3 : v < 4 ? 2 : v < 8 ? 1 : 0;
    break;
  }
  return bits;
}

export function fmtRate(hps: number): string {
  if (!isFinite(hps) || hps <= 0) return "0 H/s";
  if (hps >= 1e9) return `${(hps / 1e9).toFixed(2)} GH/s`;
  if (hps >= 1e6) return `${(hps / 1e6).toFixed(2)} MH/s`;
  if (hps >= 1e3) return `${(hps / 1e3).toFixed(1)} kH/s`;
  return `${Math.round(hps)} H/s`;
}

export function fmtHashes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}
