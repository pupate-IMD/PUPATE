// Known-answer checks for the parts of the GPU engine that run without a GPU:
//   - the round constants and rotation offsets the shader generator derives, against the Keccak reference;
//   - the unrolled keccak-f[1600] itself, through its JavaScript twin (rendered by the same generator as
//     the WGSL), against @noble/hashes' permutation on random states;
//   - the 192-byte preimage against viem's abi.encode of the contract's workHash arguments;
//   - the GPU nonce layout and the two-block path the shader takes (midstate on the CPU, block two and the
//     padding per thread), against keccak_256 of the whole preimage;
//   - the two-word compare and the GPU practice target.
// The in-browser self-test runs the WGSL itself (GpuMiner.selfTest).
//
//   cd site && node scripts/keccak-kat.mjs
import { keccakP, keccak_256 } from "@noble/hashes/sha3";
import { encodeAbiParameters } from "viem";
import { KECCAK_WGSL, RHO, ROUND_CONSTANTS, permutationJs } from "../lib/miner/gpu/keccak.ts";
import { BATCH_LIMIT, below, blockTwo, bytesHex, digestWords, gpuNonce, midstate, modelDigest, paramWords, preimage } from "../lib/miner/gpu/words.ts";
import { practiceBitsFor, targetWords } from "../lib/miner/job.ts";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}
const rnd = (n) => crypto.getRandomValues(new Uint8Array(n));
const hex = (n) => bytesHex(rnd(n));
const u32 = () => crypto.getRandomValues(new Uint32Array(1))[0];

// The Keccak reference: the 24 round constants and the rotation offsets r[x][y], lane x + 5y.
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const R = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];

check(
  "round constants match the reference",
  ROUND_CONSTANTS.length === 24 && ROUND_CONSTANTS.every(([lo, hi], i) => ((BigInt(hi) << 32n) | BigInt(lo)) === RC[i]),
);
check("rotation offsets match the reference", RHO.length === 25 && RHO.every((r, i) => r === R[i]));

// The unrolled permutation, as JavaScript, against noble's keccakP.
const twin = new Function("s", permutationJs());
let same = true;
for (let t = 0; t < 300 && same; t++) {
  const a = crypto.getRandomValues(new Uint32Array(50));
  const b = Uint32Array.from(a);
  keccakP(a, 24);
  twin(b);
  same = a.every((w, i) => w === b[i]);
}
const zero = new Uint32Array(50);
twin(zero);
const zeroRef = new Uint32Array(50);
keccakP(zeroRef, 24);
check("unrolled keccak-f[1600] equals @noble/hashes on 300 random states", same);
check(
  "unrolled keccak-f[1600] of the zero state",
  zero.every((w, i) => w === zeroRef[i]) && zero[0] === 0x40e1dde7 && zero[1] === 0xf1258f79,
  `lane 0 = 0x${zero[1].toString(16)}${zero[0].toString(16).padStart(8, "0")}`,
);

// The preimage against abi.encode(DOMAIN, chainId, contract, folded, miner, nonce).
const job = (over = {}) => ({ id: 1, domain: hex(32), chainId: 1 + (u32() % 100000), contract: hex(20), folded: hex(32), miner: hex(20), ...targetWords(20), bits: 20, ...over });
let encOk = true;
for (let t = 0; t < 50 && encOk; t++) {
  const j = job();
  const nonce = rnd(32);
  const want = encodeAbiParameters(
    [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "address" }, { type: "uint256" }],
    [j.domain, BigInt(j.chainId), j.contract, j.folded, j.miner, BigInt(bytesHex(nonce))],
  );
  encOk = bytesHex(preimage(j, nonce)) === want;
}
check("preimage equals abi.encode of the workHash arguments (50 random)", encOk);

// The GPU nonce: 24 random bytes, the GPU lane 0xff, the batch in three bytes and the thread index in four.
{
  const high = rnd(24);
  const n = gpuNonce(high, 0x123456, 0x89abcdef);
  const ok =
    bytesHex(n.subarray(0, 24)) === bytesHex(high) &&
    n[24] === 0xff &&
    n[25] === 0x12 &&
    n[26] === 0x34 &&
    n[27] === 0x56 &&
    n[28] === 0x89 &&
    n[29] === 0xab &&
    n[30] === 0xcd &&
    n[31] === 0xef;
  check("GPU nonce layout", ok, bytesHex(n.subarray(24)));
}

// Block two: the 13 words after the midstate are preimage bytes 136..187, word 12 holds 0xff and the batch.
{
  const j = job();
  const high = rnd(24);
  const blk = blockTwo(j, high, 0x0a0b0c);
  const pre = preimage(j, gpuNonce(high, 0x0a0b0c, 0));
  const le = (o) => (pre[o] | (pre[o + 1] << 8) | (pre[o + 2] << 16) | (pre[o + 3] << 24)) >>> 0;
  check("block two words are the preimage's bytes 136..187", blk.length === 13 && blk.every((w, k) => w === le(136 + 4 * k)));
  check("block two word 12 carries the GPU lane and the batch", blk[12] === 0x0c0b0aff, `0x${blk[12].toString(16)}`);
  check("block two word 0 is the miner word's zero padding", blk[0] === 0);
}

// The shader's path, on the CPU: midstate, block two, the thread's index and the padding, one permutation.
{
  let ok = true;
  let tried = 0;
  const viaTwin = (s) => twin(s);
  const viaNoble = (s) => keccakP(s, 24);
  for (let t = 0; t < 40 && ok; t++) {
    const j = job();
    const high = rnd(24);
    const mid = midstate(j);
    for (const batch of [0, 1, 0x123456, BATCH_LIMIT - 1, u32() % BATCH_LIMIT]) {
      const blk = blockTwo(j, high, batch);
      for (const index of [0, 1, 255, 256, (1 << 22) - 1, 0xffffffff, u32()]) {
        const want = bytesHex(keccak_256(preimage(j, gpuNonce(high, batch, index))));
        ok = bytesHex(modelDigest(mid, blk, index, viaTwin)) === want && bytesHex(modelDigest(mid, blk, index, viaNoble)) === want;
        tried++;
        if (!ok) break;
      }
      if (!ok) break;
    }
  }
  check("midstate + block two + padding equals keccak_256 of the whole preimage", ok, `${tried} nonces`);
}

// The uniform: 52 midstate words (50 and padding), 16 block-two words (13 and padding), then the run.
{
  const j = job();
  const high = rnd(24);
  const mid = midstate(j);
  const blk = blockTwo(j, high, 77);
  const p = paramWords(mid, blk, j, 77);
  const ok =
    p.length === 72 &&
    mid.every((w, i) => p[i] === w) &&
    p[50] === 0 &&
    p[51] === 0 &&
    blk.every((w, k) => p[52 + k] === w) &&
    p[65] === 0 &&
    p[68] === j.targetHi &&
    p[69] === j.targetLo &&
    p[70] === 77 &&
    p[71] === 0;
  check("uniform layout: midstate, block two, target words, batch", ok);
}

// The two-word compare against the full 64-bit compare.
{
  let ok = true;
  for (let t = 0; t < 20000 && ok; t++) {
    const d = rnd(32);
    if (t % 3 === 0) d.set(rnd(4).fill(d[0] & 1 ? 0 : 0xff), 0);
    const { hi, lo } = digestWords(d);
    const tw = targetWords(t % 65);
    if (t % 5 === 0) tw.targetHi = hi;
    const top = (BigInt(hi) << 32n) | BigInt(lo);
    const tgt = (BigInt(tw.targetHi) << 32n) | BigInt(tw.targetLo);
    ok = below(hi, lo, tw.targetHi, tw.targetLo) === top < tgt;
  }
  check("two-word compare equals the 64-bit compare (20,000 random)", ok);
  const d = new Uint8Array(32).fill(0xff);
  d.set([0x00, 0x00, 0x0f, 0xff], 0);
  const w = digestWords(d);
  const t20 = targetWords(20);
  const t21 = targetWords(21);
  check("a digest with 20 leading zero bits meets 20 bits, not 21", below(w.hi, w.lo, t20.targetHi, t20.targetLo) && !below(w.hi, w.lo, t21.targetHi, t21.targetLo));
  const ones = targetWords(0);
  check("bits 0 is the all-ones target", ones.targetHi === 0xffffffff && ones.targetLo === 0xffffffff);
}

// The GPU practice target: about four seconds a hash at the measured rate, within 20..40 bits.
check(
  "practice bits follow the rate",
  practiceBitsFor(0) === 20 && practiceBitsFor(1e5) === 20 && practiceBitsFor(2 ** 28) === 30 && practiceBitsFor(1e9) === 32 && practiceBitsFor(1e15) === 40,
  [1e6, 1e8, 5e8, 1e9, 3e9].map((r) => `${r.toExponential(0)} H/s -> ${practiceBitsFor(r)}`).join(", "),
);

// The WGSL: one entry point, 24 rounds, every round constant once, no unresolved values.
{
  const rounds = (KECCAK_WGSL.match(/\/\/ round \d+/g) ?? []).length;
  const iotas = ROUND_CONSTANTS.every(([lo, hi]) => KECCAK_WGSL.includes(`vec2<u32>(0x${lo.toString(16)}u, 0x${hi.toString(16)}u)`));
  const bad = /undefined|NaN|\[object/.test(KECCAK_WGSL);
  check(
    "WGSL: 24 unrolled rounds with their constants",
    rounds === 24 && iotas && !bad && KECCAK_WGSL.includes("@compute @workgroup_size(256)"),
    `${KECCAK_WGSL.length} chars, ${KECCAK_WGSL.split("\n").length} lines`,
  );
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
