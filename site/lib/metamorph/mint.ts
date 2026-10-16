// The mint, from a found hash to the card: the price against the balance, the PUPATE approval (once, for
// every mint, and re-checked before each one since an epoch step raises the price), the vault's duties read
// from dutiesDue() and paid for in the gas limit, mint(anchor, nonce) sent through the wallet, and the
// receipt read back for the card (Minted) and what the duties paid (DutyRun). A mint is sent once: when the
// wallet's answer or the receipt goes missing, the chain is watched until it shows what became of it
// (settleMint), and a reverted receipt is told apart by the chain (revertReason). The lines the field notes
// print are here too, so the page and the checks share them.
//
// The gas rule is the contract's (MetamorphMD.sol, CONVERT_BACKOFF and _duties): the estimate, plus
// 400,000 for each due flush or burn and 1,000,000 for a due conversion. An estimate alone runs the duties
// only as far as the node's search allows.
//
// Relative imports only, no "@/" alias: scripts/mine-logic.mjs runs this file in Node.
import {
  BaseError,
  ContractFunctionRevertedError,
  formatUnits,
  isAddressEqual,
  maxUint256,
  parseEventLogs,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
  type Log,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { cocoonAbi, erc20Abi } from "../abi";
import { metamorphAbi } from "./abi";
import { ANCHOR_WINDOW, MULTICALL3, type LiveAddresses, type LiveJob, chainNow } from "./job";

/// The padding for each due flush or burn: the contract's DUTY_GAS.
export const DUTY_PAD = 400_000n;
/// The padding for a due conversion: CONVERT_GAS (900,000) and enough above it that a conversion failing
/// with its whole allowance arms the back-off (more than about 924,300 left at the call).
export const CONVERT_PAD = 1_000_000n;

export interface Duties {
  flushDue: boolean;
  burnDue: boolean;
  convertDue: boolean;
}

/// The gas limit a mint is sent with: the estimate + 400,000 x (due flush + due burn) + 1,000,000 for a due
/// conversion.
export function paddedGas(estimate: bigint, d: Duties): bigint {
  return estimate + DUTY_PAD * (BigInt(d.flushDue) + BigInt(d.burnDue)) + (d.convertDue ? CONVERT_PAD : 0n);
}

/// A contract write through the visitor's wallet, resolving to the transaction hash: wagmi's
/// writeContractAsync on the page (bound to the target chain), a viem wallet client in the checks.
export type WriteContract = (call: { address: Address; abi: Abi; functionName: string; args: readonly unknown[]; gas?: bigint }) => Promise<Hex>;

// ------------------------------------------------------------------ before the mint

/// What the page shows before a run: the price, the epoch and the difficulty, and with a wallet its
/// PUPATE balance and what it allows the token to take.
export interface MintStatus {
  price: bigint;
  epoch: number;
  bits: number;
  balance: bigint | null;
  allowance: bigint | null;
}

export async function mintStatus(client: PublicClient, a: LiveAddresses, wallet: Address | null): Promise<MintStatus> {
  const who = wallet ?? zeroAddress;
  const [price, epoch, bits, balance, allowance] = await client.multicall({
    allowFailure: false,
    multicallAddress: MULTICALL3,
    contracts: [
      { address: a.metamorph, abi: metamorphAbi, functionName: "mintPrice" },
      { address: a.metamorph, abi: metamorphAbi, functionName: "epoch" },
      { address: a.metamorph, abi: metamorphAbi, functionName: "bits" },
      { address: a.token, abi: erc20Abi, functionName: "balanceOf", args: [who] },
      { address: a.token, abi: erc20Abi, functionName: "allowance", args: [who, a.metamorph] },
    ],
  });
  return { price, epoch, bits, balance: wallet ? balance : null, allowance: wallet ? allowance : null };
}

/// Approves the token to take PUPATE for every mint (type(uint256).max) and waits for the block.
export async function approvePupate(client: PublicClient, a: LiveAddresses, write: WriteContract): Promise<Hex> {
  const hash = await write({ address: a.token, abi: erc20Abi, functionName: "approve", args: [a.metamorph, maxUint256] });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`the approval ${hash} reverted`);
  return hash;
}

/// Why a found hash is not sent: the wallet holds less PUPATE than the price ("short"); someone minted
/// first ("lost"); the wallet's own mint of this hash already landed ("landed", after a send whose answer
/// went missing); the target moved under the hash ("difficulty"); the anchor left the window ("expired");
/// the contract could draw no seat ("nothing": its NothingMineable, which an empty mineableSeats() alone no
/// longer raises since the commons); all 3,333 are minted ("soldOut").
export type Refusal = "short" | "lost" | "landed" | "difficulty" | "expired" | "nothing" | "soldOut";

export type Prepared =
  | { ok: true; price: bigint; balance: bigint; duties: Duties; estimate: bigint; gas: bigint; approved: boolean }
  | { ok: false; why: Refusal; price: bigint; balance: bigint };

/// Everything before the wallet signs the mint, re-read for every hash: the price and the balance, the
/// allowance (approved once, to the maximum, when it is below the price), the duties due, and the gas
/// estimate of `mint(anchor, nonce)` from the wallet, padded for the duties. A refused estimate is read for
/// its reason; `NotASolution` is told apart by re-reading prevWork (the contract has no StaleWork).
export async function prepareMint(
  client: PublicClient,
  a: LiveAddresses,
  p: {
    wallet: Address;
    job: Pick<LiveJob, "anchor" | "prevWork">;
    nonce: bigint;
    /// The hash's proof, so that a mint of it which already landed is recognised.
    work?: Hex;
    write: WriteContract;
    /// Called before the approval is sent, for the field notes.
    onApprove?: () => void;
  },
): Promise<Prepared> {
  const [price, balance, allowance] = await client.multicall({
    allowFailure: false,
    multicallAddress: MULTICALL3,
    contracts: [
      { address: a.metamorph, abi: metamorphAbi, functionName: "mintPrice" },
      { address: a.token, abi: erc20Abi, functionName: "balanceOf", args: [p.wallet] },
      { address: a.token, abi: erc20Abi, functionName: "allowance", args: [p.wallet, a.metamorph] },
    ],
  });
  if (balance < price) return { ok: false, why: "short", price, balance };
  let approved = false;
  if (allowance < price) {
    p.onApprove?.();
    await approvePupate(client, a, p.write);
    approved = true;
  }
  const due = client.readContract({ address: a.metamorph, abi: metamorphAbi, functionName: "dutiesDue" });
  let estimate: bigint;
  try {
    estimate = await client.estimateContractGas({
      address: a.metamorph,
      abi: metamorphAbi,
      functionName: "mint",
      args: [p.job.anchor, p.nonce],
      account: p.wallet,
    });
  } catch (e) {
    due.catch(() => undefined);
    const why = await refusalOf(client, a, e, p.job.prevWork, p.work);
    if (why) return { ok: false, why, price, balance };
    throw e;
  }
  const [flushDue, burnDue, convertDue] = await due;
  const duties = { flushDue, burnDue, convertDue };
  return { ok: true, price, balance, duties, estimate, gas: paddedGas(estimate, duties), approved };
}

/// The contract's reason for a refused estimate, as a Refusal, or null when it is not one of the mint's.
async function refusalOf(client: PublicClient, a: LiveAddresses, e: unknown, prevWork: Hex, work?: Hex): Promise<Refusal | null> {
  switch (revertName(e)) {
    case "NotASolution": {
      const now = (await client.readContract({ address: a.metamorph, abi: metamorphAbi, functionName: "prevWork" })).toLowerCase();
      if (work && now === work.toLowerCase()) return "landed";
      return now === prevWork.toLowerCase() ? "difficulty" : "lost";
    }
    case "BadAnchor":
      return "expired";
    case "NothingMineable":
      return "nothing";
    case "SupplyExhausted":
      return "soldOut";
    default:
      return null;
  }
}

/// The custom error a call reverted with, by name, when viem could decode it from the ABI.
export function revertName(e: unknown): string | null {
  if (!(e instanceof BaseError)) return null;
  const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
  return r instanceof ContractFunctionRevertedError ? (r.data?.errorName ?? null) : null;
}

/// The visitor said no in the wallet (EIP-1193 code 4001), anywhere in the error's chain.
export function isUserRejection(e: unknown): boolean {
  const said = (x: unknown) => {
    const y = x as { code?: unknown; name?: unknown } | null;
    return y?.code === 4001 || y?.name === "UserRejectedRequestError";
  };
  if (e instanceof BaseError) return e.walk(said) !== null;
  return said(e);
}

/// An error in one short line for the field notes, in the page's words: viem's messages name the contract
/// function that failed (`The contract function "anchorHash" returned no data`), and the page never shows
/// those names.
export function errorText(e: unknown): string {
  const x = e as { shortMessage?: string; message?: string } | null;
  const line = String(x?.shortMessage ?? x?.message ?? e).split("\n")[0];
  return line.replace(/the contract function "[^"]*"/gi, "a contract call").slice(0, 120);
}

// ------------------------------------------------------------------ the mint and its receipt

/// Sends `mint(anchor, nonce)` with the padded gas limit; the wallet signs.
export function sendMint(write: WriteContract, a: LiveAddresses, anchor: bigint, nonce: bigint, gas: bigint): Promise<Hex> {
  return write({ address: a.metamorph, abi: metamorphAbi, functionName: "mint", args: [anchor, nonce], gas });
}

/// The card a mint made, from its Minted event.
export interface MintedCard {
  id: bigint;
  seat: bigint;
  round: number;
  edition: number;
  miner: Address;
  work: Hex;
  gilt: boolean;
  price: bigint;
  epoch: number;
}

/// A duty the mint ran (DutyRun): 0 the hook's flush, 1 the vault's burn, 2 the pot's conversion. `paid`
/// is what the miner received (ETH wei for a burn, IMD wei for a conversion); `burned` is the ETH the burn
/// spent, from Cocoon's Burned log in the same receipt.
export interface DutyPaid {
  kind: number;
  paid: bigint;
  burned?: bigint;
}

export interface MintOutcome {
  status: "success" | "reverted";
  /// The card, when the receipt holds a Minted for this miner; null is the lost race.
  minted: MintedCard | null;
  duties: DutyPaid[];
  lost: boolean;
}

/// Reads a mint's receipt. Only the token's own logs count for the card and the duties, and only the
/// Burned whose caller is the token for the ETH a burn spent. No Minted for this miner (a reverted mint:
/// someone else's landed first in the same block) is the lost race; the page never reports a card it did
/// not get.
export function parseMintReceipt(
  receipt: { status: "success" | "reverted"; logs: readonly Log[] },
  a: Pick<LiveAddresses, "metamorph" | "cocoon">,
  miner: Address,
): MintOutcome {
  const own = receipt.logs.filter((l) => isAddressEqual(l.address, a.metamorph));
  const vault = receipt.logs.filter((l) => isAddressEqual(l.address, a.cocoon));
  const burn = parseEventLogs({ abi: cocoonAbi, logs: vault, eventName: "Burned" }).find((l) => isAddressEqual(l.args.caller, a.metamorph));
  let minted: MintedCard | null = null;
  const duties: DutyPaid[] = [];
  for (const ev of parseEventLogs({ abi: metamorphAbi, logs: own, eventName: ["Minted", "DutyRun"] })) {
    if (ev.eventName === "Minted") {
      if (!minted && isAddressEqual(ev.args.miner, miner)) minted = { ...ev.args };
    } else if (ev.eventName === "DutyRun") {
      duties.push(ev.args.kind === 1 && burn ? { kind: 1, paid: ev.args.paid, burned: burn.args.ethSpent } : { kind: ev.args.kind, paid: ev.args.paid });
    }
  }
  return { status: receipt.status, minted, duties: minted ? duties : [], lost: minted === null };
}

/// A card of this miner with this proof among the Minted logs from `fromBlock`: how a mint whose receipt
/// went missing is found again once prevWork shows it landed.
export async function findMinted(client: PublicClient, a: LiveAddresses, miner: Address, work: Hex, fromBlock: bigint): Promise<MintedCard | null> {
  const logs = await client.getContractEvents({ address: a.metamorph, abi: metamorphAbi, eventName: "Minted", args: { miner }, fromBlock });
  const hit = logs.find((l) => l.args.work?.toLowerCase() === work.toLowerCase());
  return hit ? ({ ...hit.args } as MintedCard) : null;
}

// ------------------------------------------------------------------ a mint whose answer went missing

/// Where a mint stands whose answer went missing (the wallet's, or the block's), as the chain shows it now:
/// its proof is prevWork ("landed"); prevWork moved to another proof ("moved": someone minted first, or this
/// mint landed and another followed, which findMinted tells apart); prevWork unmoved and the anchor out of the
/// window, so it can no longer land ("late"); otherwise it may still land ("open"). Nodes run a call at the
/// latest block or at the next one, so "late" waits until even the later reading puts the anchor out of reach.
export function unsureMint(job: Pick<LiveJob, "anchor" | "prevWork">, work: Hex, now: { prevWork: Hex; block: bigint }): "landed" | "moved" | "late" | "open" {
  const p = now.prevWork.toLowerCase();
  if (p === work.toLowerCase()) return "landed";
  if (p !== job.prevWork.toLowerCase()) return "moved";
  return now.block - job.anchor > ANCHOR_WINDOW ? "late" : "open";
}

/// Why a mint reverted, read after its receipt: its block was past the anchor's window ("late": the hash was
/// older than 50 blocks when the mint was mined, the contract's BadAnchor), prevWork moved (someone minted
/// first: "lost"), or neither ("refused", some other refusal). `prevWorkNow` is null when it could not be read.
export function revertReason(job: Pick<LiveJob, "anchor" | "prevWork">, block: bigint, prevWorkNow: Hex | null): "late" | "lost" | "refused" {
  if (block - job.anchor > ANCHOR_WINDOW) return "late";
  if (prevWorkNow && prevWorkNow.toLowerCase() !== job.prevWork.toLowerCase()) return "lost";
  return "refused";
}

/// What became of a mint whose answer went missing.
export type Settled =
  | { kind: "receipt"; receipt: TransactionReceipt }
  | { kind: "landed"; card: MintedCard | null }
  | { kind: "lost" }
  | { kind: "late" };

/// Waits out a mint whose answer went missing, and never sends it again: the wallet failed once asked (`hash`
/// null, it may have sent the mint), or the receipt did not come. Each round reads prevWork and the block, then
/// the receipt by hash when there is one. The receipt settles it; without one, prevWork at this mint's proof
/// means it landed (its card from findMinted), prevWork at another proof means someone minted first (unless
/// findMinted finds this mint before it), and prevWork unmoved past the anchor's window means it can no longer
/// land. Until one of those shows, the caller mines nothing on this prevWork. Null once `gone()`.
export async function settleMint(
  client: PublicClient,
  a: LiveAddresses,
  p: {
    wallet: Address;
    job: Pick<LiveJob, "anchor" | "prevWork" | "block">;
    work: Hex;
    hash: Hex | null;
    /// The wait between two rounds.
    pause: () => Promise<void>;
    /// True once nobody waits for the answer (the page was left).
    gone: () => boolean;
    /// A round the chain did not answer, and how many in a row.
    onMiss?: (e: unknown, misses: number) => void;
  },
): Promise<Settled | null> {
  let misses = 0;
  while (!p.gone()) {
    try {
      const now = await chainNow(client, a);
      if (p.hash) {
        const receipt = await client.getTransactionReceipt({ hash: p.hash }).catch(() => null);
        if (receipt) return { kind: "receipt", receipt };
      }
      const where = unsureMint(p.job, p.work, now);
      if (where === "late") return { kind: "late" };
      if (where !== "open") {
        const card = await findMinted(client, a, p.wallet, p.work, p.job.block - 1n);
        return card ? { kind: "landed", card } : where === "landed" ? { kind: "landed", card: null } : { kind: "lost" };
      }
      misses = 0;
    } catch (e) {
      p.onMiss?.(e, ++misses);
    }
    await p.pause();
  }
  return null;
}

/// The JSON a token URI carries: the art returns data:application/json;base64 (a plain data:application/json
/// is read too). Null when the URI is not that shape or its text is not JSON. The workspace reads the
/// attributes from it (lib/metamorph/cards.ts).
export function tokenJSON(uri: string): unknown {
  const m = /^data:application\/json;base64,(.*)$/s.exec(uri);
  let text: string;
  try {
    if (m) {
      const bin = atob(m[1]);
      text = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    } else {
      const plain = /^data:application\/json(?:;charset=[\w-]+|;utf8)?,(.*)$/s.exec(uri);
      if (!plain) return null;
      text = decodeURIComponent(plain[1]);
    }
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/// The card's image from its token URI: the SVG inside the JSON as a data URI. Null when the URI is not
/// that shape.
export function tokenImage(uri: string): string | null {
  const image = (tokenJSON(uri) as { image?: unknown } | null)?.image;
  return typeof image === "string" && image.startsWith("data:image/") ? image : null;
}

/// Reads a minted card's image through the token's tokenURI.
export async function cardImage(client: PublicClient, a: LiveAddresses, id: bigint): Promise<string | null> {
  return tokenImage(await client.readContract({ address: a.metamorph, abi: metamorphAbi, functionName: "tokenURI", args: [id] }));
}

// ------------------------------------------------------------------ the field notes

/// The fixed lines. The first four are the spec's words.
export const LINES = {
  found: "found a valid hash · sending the mint",
  lost: "someone minted first, your hash expired · mining again",
  short: "not enough PUPATE for the mint price",
  approving: "approving PUPATE once for every mint",
  approved: "PUPATE approved for every mint",
  expired: "your hash waited too long and expired · mining again",
  difficulty: "the difficulty changed before your mint landed · mining again",
  /// NothingMineable: no seat could be drawn, held or from the whole collection (the collection's count
  /// unreadable, or every seat tried full). An empty-handed vault is not that: that is the commons.
  nothing: "no seat could be drawn for a card right now · stopped",
  soldOut: "3,333 of 3,333 minted",
  declined: "you declined in your wallet · auto-mint is off",
  /// A reverted mint whose block was past the anchor's window.
  late: "the mint ran out of time (the hash was older than 50 blocks) · mining again",
  /// A reverted mint within the window, prevWork unmoved.
  reverted: "the mint reverted · mining again",
  /// A mint whose answer went missing and that did not land while it could.
  unseen: "your mint did not land within 50 blocks · mining again",
  /// Added to the line that ends a run while a hash waits for the Mint button.
  dropped: "the waiting hash was dropped",
  /// A mint refused after its run was stopped: the hash does not wait.
  droppedStopped: "the hash was dropped · mining is stopped",
  walletGone: "wallet disconnected · stopped",
  walletChanged: "the wallet changed · stopped",
} as const;

/// A token amount for the notes: two significant digits below one (0.046, 0.00023), two decimals above.
export function amount(wei: bigint, decimals = 18): string {
  const v = Number(formatUnits(wei, decimals));
  if (v === 0) return "0";
  return v >= 1 ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : v.toLocaleString("en-US", { maximumSignificantDigits: 2 });
}

/// The success line; `next` is false when the miner is no longer running, so it does not promise the next one.
export function mintedLine(m: Pick<MintedCard, "id" | "seat" | "gilt">, next = true): string {
  return `Metamorph.md #${m.id} is yours · seat identity.md #${m.seat}${m.gilt ? " · gilt" : ""}${next ? " · mining the next one" : ""}`;
}

/// What a duty the mint ran paid the miner.
export function dutyLine(d: DutyPaid): string {
  if (d.kind === 1) {
    return d.burned !== undefined
      ? `your mint also burned ${amount(d.burned)} ETH of tax for the vault · you earned ${amount(d.paid)} ETH`
      : `your mint also burned the vault's tax · you earned ${amount(d.paid)} ETH`;
  }
  if (d.kind === 2) return `your mint also turned the stakers' share into IMD · you earned ${amount(d.paid)} IMD`;
  return "your mint also flushed the vault's tax";
}

/// The gas limit chosen, so a mint that costs more than a transfer says why.
export function gasLine(gas: bigint, padded: boolean): string {
  return `sending with ${gas.toLocaleString("en-US")} gas${padded ? ", the vault's work included" : ""}`;
}

/// The lines a mint's receipt gives: the lost race, or the card and each duty it ran.
export function outcomeLines(o: MintOutcome, next = true): string[] {
  return o.minted ? [mintedLine(o.minted, next), ...o.duties.map(dutyLine)] : [LINES.lost];
}
