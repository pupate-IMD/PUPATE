// The GPU engine's hash, as WGSL. The 192-byte preimage is two keccak-256 blocks: the first 136 bytes
// never change within a job, so the page absorbs them once on the CPU (the midstate, see words.ts), and
// each GPU thread XORs in the second block (the miner's address, its own nonce, the padding) and runs
// keccak-f[1600] once. A 64-bit lane is a vec2<u32> (lo, hi), so every rotation is split across the two
// words. The round constants and rotation offsets are derived below from the Keccak reference, and the
// 24 rounds are written out by a small generator at module load. The same generator renders a JavaScript
// twin of the permutation, which scripts/keccak-kat.mjs checks against @noble/hashes.
//
// No imports: node runs this file directly for the known-answer checks.

/// Threads per workgroup; a dispatch is always a whole number of workgroups.
export const WORKGROUP_SIZE = 256;

/// The 24 round constants as (lo, hi) words, from the reference LFSR x^8 + x^6 + x^5 + x^4 + 1.
export const ROUND_CONSTANTS: readonly (readonly [number, number])[] = (() => {
  const out: [number, number][] = [];
  let lfsr = 1;
  for (let round = 0; round < 24; round++) {
    let lo = 0;
    let hi = 0;
    for (let j = 0; j < 7; j++) {
      const bit = (1 << j) - 1;
      if (lfsr & 1) {
        if (bit < 32) lo |= 1 << bit;
        else hi |= 1 << (bit - 32);
      }
      lfsr = lfsr & 0x80 ? ((lfsr << 1) ^ 0x71) & 0xff : (lfsr << 1) & 0xff;
    }
    out.push([lo >>> 0, hi >>> 0]);
  }
  return out;
})();

/// Rotation offset of each lane (index x + 5y), from the reference walk: (x, y) starts at (1, 0), the
/// t-th step rotates by (t + 1)(t + 2) / 2 mod 64 and moves to (y, 2x + 3y).
export const RHO: readonly number[] = (() => {
  const r = new Array<number>(25).fill(0);
  let x = 1;
  let y = 0;
  for (let t = 0; t < 24; t++) {
    r[x + 5 * y] = (((t + 1) * (t + 2)) / 2) % 64;
    [x, y] = [y, (2 * x + 3 * y) % 5];
  }
  return r;
})();

/// Where pi sends each lane: (x, y) goes to (y, 2x + 3y).
export const PI: readonly number[] = Array.from({ length: 25 }, (_, i) => {
  const x = i % 5;
  const y = Math.floor(i / 5);
  return y + 5 * ((2 * x + 3 * y) % 5);
});

// One round as a list of lane operations; a renderer turns them into WGSL or JavaScript. Lanes a0..a24
// are the state; c, d and b are the round's temporaries, declared fresh inside each round's block.
type Op =
  | { k: "parity"; dst: string; src: string[] } // dst = src0 ^ src1 ^ ... (declared)
  | { k: "theta"; dst: string; a: string; b: string } // dst = a ^ rotl(b, 1) (declared)
  | { k: "mix"; dst: string; d: string } // dst ^= d
  | { k: "rho"; dst: string; src: string; r: number } // dst = rotl(src, r) (declared)
  | { k: "chi"; dst: string; a: string; b: string; c: string } // dst = a ^ (~b & c)
  | { k: "iota"; dst: string; lo: number; hi: number }; // dst ^= (lo, hi)

function round(rc: readonly [number, number]): Op[] {
  const ops: Op[] = [];
  for (let x = 0; x < 5; x++) ops.push({ k: "parity", dst: `c${x}`, src: [0, 1, 2, 3, 4].map((y) => `a${x + 5 * y}`) });
  for (let x = 0; x < 5; x++) ops.push({ k: "theta", dst: `d${x}`, a: `c${(x + 4) % 5}`, b: `c${(x + 1) % 5}` });
  for (let i = 0; i < 25; i++) ops.push({ k: "mix", dst: `a${i}`, d: `d${i % 5}` });
  for (let i = 0; i < 25; i++) ops.push({ k: "rho", dst: `b${PI[i]}`, src: `a${i}`, r: RHO[i] });
  for (let i = 0; i < 25; i++) {
    const x = i % 5;
    const row = i - x;
    ops.push({ k: "chi", dst: `a${i}`, a: `b${i}`, b: `b${row + ((x + 1) % 5)}`, c: `b${row + ((x + 2) % 5)}` });
  }
  ops.push({ k: "iota", dst: "a0", lo: rc[0], hi: rc[1] });
  return ops;
}

const h = (n: number) => `0x${n.toString(16)}`;

// WGSL: a lane is one vec2<u32> variable, (x, y) = (lo, hi).
function wgslRotl(v: string, r: number): string {
  if (r === 0) return v;
  if (r === 32) return `${v}.yx`;
  if (r < 32) return `vec2<u32>((${v}.x << ${r}u) | (${v}.y >> ${32 - r}u), (${v}.y << ${r}u) | (${v}.x >> ${32 - r}u))`;
  const s = r - 32;
  return `vec2<u32>((${v}.y << ${s}u) | (${v}.x >> ${32 - s}u), (${v}.x << ${s}u) | (${v}.y >> ${32 - s}u))`;
}

function wgsl(op: Op): string {
  switch (op.k) {
    case "parity":
      return `let ${op.dst} = ${op.src.join(" ^ ")};`;
    case "theta":
      return `let ${op.dst} = ${op.a} ^ ${wgslRotl(op.b, 1)};`;
    case "mix":
      return `${op.dst} ^= ${op.d};`;
    case "rho":
      return `let ${op.dst} = ${wgslRotl(op.src, op.r)};`;
    case "chi":
      return `${op.dst} = ${op.a} ^ (~${op.b} & ${op.c});`;
    case "iota":
      return `${op.dst} ^= vec2<u32>(${h(op.lo)}u, ${h(op.hi)}u);`;
  }
}

// JavaScript: a lane is two number variables, `${name}l` and `${name}h`; >>> is the logical shift.
function jsRotl(v: string, r: number): [string, string] {
  const [l, hh] = [`${v}l`, `${v}h`];
  if (r === 0) return [l, hh];
  if (r === 32) return [hh, l];
  if (r < 32) return [`(${l} << ${r}) | (${hh} >>> ${32 - r})`, `(${hh} << ${r}) | (${l} >>> ${32 - r})`];
  const s = r - 32;
  return [`(${hh} << ${s}) | (${l} >>> ${32 - s})`, `(${l} << ${s}) | (${hh} >>> ${32 - s})`];
}

function js(op: Op): string {
  switch (op.k) {
    case "parity":
      return `const ${op.dst}l = ${op.src.map((s) => `${s}l`).join(" ^ ")}, ${op.dst}h = ${op.src.map((s) => `${s}h`).join(" ^ ")};`;
    case "theta": {
      const [l, hh] = jsRotl(op.b, 1);
      return `const ${op.dst}l = ${op.a}l ^ (${l}), ${op.dst}h = ${op.a}h ^ (${hh});`;
    }
    case "mix":
      return `${op.dst}l ^= ${op.d}l; ${op.dst}h ^= ${op.d}h;`;
    case "rho": {
      const [l, hh] = jsRotl(op.src, op.r);
      return `const ${op.dst}l = ${l}, ${op.dst}h = ${hh};`;
    }
    case "chi":
      return `${op.dst}l = ${op.a}l ^ (~${op.b}l & ${op.c}l); ${op.dst}h = ${op.a}h ^ (~${op.b}h & ${op.c}h);`;
    case "iota":
      return `${op.dst}l ^= ${h(op.lo)}; ${op.dst}h ^= ${h(op.hi)};`;
  }
}

/// The 24 rounds, unrolled, over lanes a0..a24 already in scope; each round is a block of its own.
export function permutationSource(lang: "wgsl" | "js", indent = "  "): string {
  const render = lang === "wgsl" ? wgsl : js;
  const lines: string[] = [];
  ROUND_CONSTANTS.forEach((rc, n) => {
    lines.push(`${indent}{ // round ${n}`);
    for (const op of round(rc)) lines.push(`${indent}  ${render(op)}`);
    lines.push(`${indent}}`);
  });
  return lines.join("\n");
}

/// A JavaScript function body over `s`, a Uint32Array(50) in noble's layout (lane i = words 2i lo, 2i + 1
/// hi), that permutes it in place with the generated rounds. Only the known-answer script compiles it.
export function permutationJs(): string {
  const load = Array.from({ length: 25 }, (_, i) => `let a${i}l = s[${2 * i}] | 0, a${i}h = s[${2 * i + 1}] | 0;`).join("\n");
  const store = Array.from({ length: 25 }, (_, i) => `s[${2 * i}] = a${i}l; s[${2 * i + 1}] = a${i}h;`).join("\n");
  return `${load}\n${permutationSource("js")}\n${store}`;
}

// The shader's inputs, per lane: the midstate's lane i is P.mid[i >> 1].xy or .zw; block two's lanes 0..5
// are P.blk likewise, lane 6 is (P.blk[3].x, the thread index byte-swapped), lane 7 and lane 16 take the
// padding (0x01 at block byte 56, 0x80 at block byte 135).
function loadLane(i: number): string {
  const mid = `P.mid[${i >> 1}].${i & 1 ? "zw" : "xy"}`;
  if (i < 6) return `${mid} ^ P.blk[${i >> 1}].${i & 1 ? "zw" : "xy"}`;
  if (i === 6) return `${mid} ^ vec2<u32>(P.blk[3].x, bswap(index))`;
  if (i === 7) return `${mid} ^ vec2<u32>(0x1u, 0x0u)`;
  if (i === 16) return `${mid} ^ vec2<u32>(0x0u, 0x80000000u)`;
  return mid;
}

/// The compute shader: one nonce per thread. Bindings: 0 the uniform (midstate, block two, target words,
/// batch), 1 the output (hit count, thread 0's digest, hit records as (batch, index, hi, lo)).
export const KECCAK_WGSL = `// keccak-256 of the Metamorph MD puzzle's second block, one nonce per thread. Generated by keccak.ts.
struct Params {
  mid: array<vec4<u32>, 13>, // the state after block one: lane i = (word 2i, word 2i + 1), 50 words
  blk: array<vec4<u32>, 4>,  // preimage bytes 136..187 as little-endian words: the miner, the nonce's first 28 bytes
  run: vec4<u32>,            // (target hi, target lo, batch, unused)
}

struct Out {
  hits: atomic<u32>,
  pad: array<u32, 3>,
  sample: array<vec4<u32>, 2>, // thread 0's digest, its 32 bytes in order
  rec: array<vec4<u32>>,       // (batch, thread index, digest word 0, digest word 1) per hit
}

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read_write> O: Out;

fn bswap(x: u32) -> u32 {
  return (x << 24u) | ((x & 0xff00u) << 8u) | ((x >> 8u) & 0xff00u) | (x >> 24u);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
${Array.from({ length: 25 }, (_, i) => `  var a${i} = ${loadLane(i)};`).join("\n")}
${permutationSource("wgsl")}
  // The digest's first eight bytes are lane 0, little-endian; as big-endian words they are the compare.
  let hi = bswap(a0.x);
  let lo = bswap(a0.y);
  if (index == 0u) {
    O.sample[0] = vec4<u32>(a0, a1);
    O.sample[1] = vec4<u32>(a2, a3);
  }
  if (hi < P.run.x || (hi == P.run.x && lo < P.run.y)) {
    let slot = atomicAdd(&O.hits, 1u);
    if (slot < arrayLength(&O.rec)) {
      O.rec[slot] = vec4<u32>(P.run.z, index, hi, lo);
    }
  }
}
`;
