// Live jobs: the MinerJob the engines grind, built from Metamorph MD's state as the contract will check it.
//
//   work = keccak256(abi.encode(DOMAIN, block.chainid, address(this), keccak256(abi.encode(anchorHash, prevWork)), miner, nonce))
//
// and a proof is valid while `work < effectiveTarget()`, the anchor is 1 to 50 blocks behind the mint's
// block, and `prevWork` is still the last mint's proof (src/metamorph/MetamorphMD.sol: workHash, _anchor,
// mint). The page reads the state every three seconds and builds the job afresh when `prevWork` or the
// target moved, or when the anchor is ten blocks from the end of its window. The anchor's hash comes from
// the contract's `anchorHash(n)`, never from a block the client fetched itself.
//
// Relative imports only, no "@/" alias: scripts/mine-logic.mjs runs this file in Node.
import { encodeAbiParameters, isAddressEqual, keccak256, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import type { Addresses } from "../addresses";
import { type MinerJob, targetWordsFrom } from "../miner/job";
import { metamorphAbi } from "./abi";

export const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";

/// Multicall3's own views, so the block number and the chain id come from the batch that reads the state.
const multicall3Views = parseAbi([
  "function getBlockNumber() view returns (uint256 blockNumber)",
  "function getChainId() view returns (uint256 chainid)",
]);

/// The contract's ANCHOR_WINDOW: a proof's anchor may be at most this many blocks behind the mint.
export const ANCHOR_WINDOW = 50n;
/// A job is built afresh once its anchor is this old, ten blocks before the window closes.
export const ANCHOR_REBUILD_AGE = ANCHOR_WINDOW - 10n;

/// The addresses of a chain where Metamorph MD is deployed.
export type LiveAddresses = Addresses & { metamorph: Address };

/// A MinerJob from the chain, with what the mint and the poller need besides the engines' words.
export interface LiveJob extends MinerJob {
  live: true;
  /// The block whose hash is folded in: one before `block`. `mint(anchor, nonce)` names it.
  anchor: bigint;
  /// `anchorHash(anchor)` as the contract returned it.
  anchorHash: Hex;
  /// The last mint's proof; any mint replaces it and voids every open search.
  prevWork: Hex;
  /// `effectiveTarget()` when the job was read: a proof must be below it.
  target: bigint;
  /// `mintPrice()` when the job was read, in PUPATE wei.
  price: bigint;
  /// The block number the reads ran at.
  block: bigint;
}

export function isLiveJob(j: MinerJob | null | undefined): j is LiveJob {
  return !!j && j.live === true;
}

/// keccak256(abi.encode(anchorHash, prevWork)): the word the contract's workHash folds the two into.
export function fold(anchorHash: Hex, prevWork: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [anchorHash, prevWork]));
}

/// The proof the contract computes for this job and nonce, with viem's encoder: an implementation apart
/// from the engines' byte builders, so a find is checked against it before anything is sent.
export function workOf(job: Pick<MinerJob, "domain" | "chainId" | "contract" | "folded" | "miner">, nonce: bigint): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "address" }, { type: "uint256" }],
      [job.domain, BigInt(job.chainId), job.contract, job.folded, job.miner, nonce],
    ),
  );
}

/// True when a proof passes the job's whole 256-bit target, as `mint` checks it.
export function meets(job: Pick<LiveJob, "target">, work: Hex): boolean {
  return BigInt(work) < job.target;
}

/// DOMAIN per chain and contract: a constant, read once.
const domains = new Map<string, Hex>();

/// The job for `miner` as the chain stands. Two reads: one batch for the state (prevWork, the target, bits,
/// the price, and the block number and chain id the batch ran at), then `anchorHash(block − 1)`, the newest
/// block whose hash the contract can see whether a node runs a call at the latest block or the next one.
/// DOMAIN is read with the first job and kept. Throws when the node has no hash for the anchor yet (a
/// lagging node behind a load balancer); the next poll tries again.
export async function liveJob(client: PublicClient, a: LiveAddresses, miner: Address, id = 0): Promise<LiveJob> {
  const contract = a.metamorph;
  const key = `${a.chainId}:${contract.toLowerCase()}`;
  const known = domains.get(key);
  const [domain, state] = await Promise.all([
    known ?? client.readContract({ address: contract, abi: metamorphAbi, functionName: "DOMAIN" }),
    client.multicall({
      allowFailure: false,
      multicallAddress: MULTICALL3,
      contracts: [
        { address: contract, abi: metamorphAbi, functionName: "prevWork" },
        { address: contract, abi: metamorphAbi, functionName: "effectiveTarget" },
        { address: contract, abi: metamorphAbi, functionName: "bits" },
        { address: contract, abi: metamorphAbi, functionName: "mintPrice" },
        { address: MULTICALL3, abi: multicall3Views, functionName: "getBlockNumber" },
        { address: MULTICALL3, abi: multicall3Views, functionName: "getChainId" },
      ],
    }),
  ]);
  const [prevWork, target, bits, price, block, chainId] = state;
  if (Number(chainId) !== a.chainId) throw new Error(`the node answers for chain ${chainId}, the addresses are for chain ${a.chainId}`);
  domains.set(key, domain);
  const anchor = block - 1n;
  const anchorHash = await client.readContract({ address: contract, abi: metamorphAbi, functionName: "anchorHash", args: [anchor] });
  if (BigInt(anchorHash) === 0n) throw new Error(`the node has no hash for block ${anchor} yet`);
  return {
    id,
    domain,
    chainId: Number(chainId),
    contract,
    folded: fold(anchorHash, prevWork),
    miner,
    ...targetWordsFrom(target),
    bits,
    live: true,
    anchor,
    anchorHash,
    prevWork,
    target,
    price,
    block,
  };
}

/// prevWork and the block number from one batch: what a mint whose answer went missing is judged by.
export async function chainNow(client: PublicClient, a: LiveAddresses): Promise<{ prevWork: Hex; block: bigint }> {
  const [prevWork, block] = await client.multicall({
    allowFailure: false,
    multicallAddress: MULTICALL3,
    contracts: [
      { address: a.metamorph, abi: metamorphAbi, functionName: "prevWork" },
      { address: MULTICALL3, abi: multicall3Views, functionName: "getBlockNumber" },
    ],
  });
  return { prevWork, block };
}

/// A job must be rebuilt: someone minted (prevWork moved), or the target moved (it eases with silence and
/// steps at every mint), or the job is for another contract, chain or miner.
export function jobChanged(prev: LiveJob, next: LiveJob): boolean {
  return (
    prev.prevWork !== next.prevWork ||
    prev.targetHi !== next.targetHi ||
    prev.targetLo !== next.targetLo ||
    prev.target !== next.target ||
    prev.chainId !== next.chainId ||
    !isAddressEqual(prev.contract, next.contract) ||
    !isAddressEqual(prev.miner, next.miner)
  );
}

/// The job's anchor is within ten blocks of leaving the contract's 50-block window at block `block`.
export function anchorExpiring(job: Pick<LiveJob, "anchor">, block: bigint): boolean {
  return block - job.anchor >= ANCHOR_REBUILD_AGE;
}

/// The noted seats the vault holds with editions left, in pick order. None is the commons: a mint then draws
/// its seat from the whole identity.md collection, and the job is the same either way, so a live run never
/// waits on this list (the numbers read it for the ready line, and the checks read it on the stack).
export async function mineableSeats(client: PublicClient, a: LiveAddresses): Promise<readonly bigint[]> {
  return client.readContract({ address: a.metamorph, abi: metamorphAbi, functionName: "mineableSeats" });
}
