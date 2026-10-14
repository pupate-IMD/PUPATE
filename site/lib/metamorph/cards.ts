// The workspace's reads (the /cards page): the cards a wallet holds, each with its facts, stage and stake;
// the IMD the wallet earned and has not claimed; each card's image from tokenURI, cached per id, stage and
// gilt; every minted card for the gallery; the miners by cards for the leaderboard; and the three writes.
//
// The token keeps no list of a wallet's cards (ERC721Lite has no enumeration), so they come from its
// Transfer logs: those to the wallet and those from it, read in chunks the node accepts (the pattern of
// lib/live.ts's logsOf), from the addresses' fromBlock once and then only the blocks not seen yet, and
// folded into the set the wallet holds (a card is the wallet's when its last transfer went to it). ownerOf,
// read with the facts, confirms each card.
//
// The images: tokenURI's JSON carries the card as an SVG data URI, shown as <img src>, never inlined (every
// card's SVG repeats the same element ids) and never drawn here. A card's image changes only with its stage,
// so it is read at most once per (id, stage, gilt) and kept in memory and in localStorage; the stage is read
// live, so an emerged card is read again. Storage may be missing, full or refused: every access is guarded,
// and the page works without it.
//
// Relative imports only, no "@/" alias: scripts/mine-logic.mjs runs this file in Node.
import {
  getAbiItem,
  isAddressEqual,
  parseEventLogs,
  zeroAddress,
  type Address,
  type ContractFunctionParameters,
  type Hex,
  type Log,
  type PublicClient,
} from "viem";
import { metamorphAbi } from "./abi";
import { MULTICALL3, type LiveAddresses } from "./job";
import { type WriteContract, tokenJSON } from "./mint";

/// accIMDPerWeight's unit, the contract's ACC.
const ACC = 10n ** 18n;
const LOG_CHUNK = 50_000n;
/// The last blocks are read again on every poll: a node behind its peers may have answered without them.
/// The folds below take a log twice as once.
const OVERLAP = 12n;
/// tokenURI reads at a time: the art draws each card on the node, so the gallery asks a few at once.
const IMAGE_READS = 4;
/// Images kept in memory, the least recently shown dropped first.
const MEMORY_IMAGES = 600;
export const IMAGE_PREFIX = "metamorph:img:";

const TRANSFER = getAbiItem({ abi: metamorphAbi, name: "Transfer" });
const MINTED = getAbiItem({ abi: metamorphAbi, name: "Minted" });
const token = (a: LiveAddresses) => ({ address: a.metamorph, abi: metamorphAbi }) as const;
/// One token on one chain: the ledgers and the images of another deployment never mix with these.
const scope = (a: Pick<LiveAddresses, "chainId" | "metamorph">) => `${a.chainId}:${a.metamorph.toLowerCase()}`;

/// The stage in the page's words: 0 in the cocoon (a chrysalis), 1 emerged (a butterfly).
export function stageWord(stage: number): string {
  return stage === 1 ? "emerged" : "in the cocoon";
}

// ------------------------------------------------------------------ logs, in chunks the node accepts

/// True when an endpoint refused a log query for its block range (as lib/live.ts reads it).
function isRangeRefusal(e: unknown): boolean {
  const x = e as { code?: number; details?: string; shortMessage?: string; message?: string; cause?: { code?: number } };
  const code = x?.code ?? x?.cause?.code;
  const text = `${x?.details ?? ""} ${x?.shortMessage ?? ""} ${x?.message ?? ""}`;
  return code === -32600 || code === -32005 || code === -32602 || /block range|too many|exceed|more than|limit/i.test(text);
}

/// The chunk size the endpoint accepted last, so later reads start from it.
let learnedChunk = LOG_CHUNK;

/// A range read in chunks: when the endpoint refuses one, the chunk is halved and tried again.
async function inChunks<T>(from: bigint, to: bigint, read: (from: bigint, to: bigint) => Promise<readonly T[]>): Promise<T[]> {
  const out: T[] = [];
  let chunk = learnedChunk;
  for (let start = from; start <= to; ) {
    const end = start + chunk - 1n < to ? start + chunk - 1n : to;
    // A refused range comes back as null and the chunk shrinks; anything else is a real failure.
    const got = await read(start, end).catch((e: unknown) => {
      if (!isRangeRefusal(e) || chunk <= 1n) throw e;
      return null;
    });
    if (got === null) {
      chunk = chunk / 2n < 1n ? 1n : chunk / 2n;
      learnedChunk = chunk;
      continue;
    }
    for (const x of got) out.push(x);
    start = end + 1n;
  }
  return out;
}

/// Where the next read starts: OVERLAP blocks before the first unseen one, never before fromBlock.
function nextFrom(through: bigint, fromBlock: bigint): bigint {
  const from = through + 1n - OVERLAP;
  return from < fromBlock ? fromBlock : from;
}

// ------------------------------------------------------------------ the wallet's cards

/// One Transfer, as the fold reads it.
export interface TransferLog {
  from: Address;
  to: Address;
  id: bigint | number;
  blockNumber: bigint;
  logIndex: number;
}

/// A card's last transfer seen: where it sits in the chain, and whether it went to the wallet.
export interface LastTransfer {
  block: bigint;
  index: number;
  mine: boolean;
}

/// Folds Transfer logs into what the wallet holds: a card is the wallet's when its last transfer, by block
/// and log index, went to the wallet. The logs may come in any order and more than once; `prior` is the fold
/// of earlier logs, so a poll adds only the blocks it read. A card minted to the wallet, sent away and sent
/// back is the wallet's once.
export function foldTransfers(logs: readonly TransferLog[], wallet: Address, prior?: ReadonlyMap<number, LastTransfer>): Map<number, LastTransfer> {
  const fold = new Map(prior);
  for (const l of logs) {
    const id = Number(l.id);
    const was = fold.get(id);
    if (was && (was.block > l.blockNumber || (was.block === l.blockNumber && was.index >= l.logIndex))) continue;
    fold.set(id, { block: l.blockNumber, index: l.logIndex, mine: isAddressEqual(l.to, wallet) });
  }
  return fold;
}

/// The ids a fold says the wallet holds, in order.
export function heldIds(fold: ReadonlyMap<number, LastTransfer>): number[] {
  return [...fold]
    .filter(([, t]) => t.mine)
    .map(([id]) => id)
    .sort((x, y) => x - y);
}

/// Per wallet: the fold of its Transfer logs through the last block read.
const ledgers = new Map<string, { through: bigint; fold: Map<number, LastTransfer> }>();

/// The ids the wallet holds by its Transfer logs, reading only the blocks after the last one seen.
async function heldBy(client: PublicClient, a: LiveAddresses, wallet: Address): Promise<number[]> {
  const key = `${scope(a)}:${wallet.toLowerCase()}`;
  const start = BigInt(a.fromBlock);
  const head = await client.getBlockNumber({ cacheTime: 0 });
  const seen = ledgers.get(key) ?? { through: start - 1n, fold: new Map<number, LastTransfer>() };
  if (head > seen.through) {
    const from = nextFrom(seen.through, start);
    const read = (args: { from: Address } | { to: Address }) =>
      inChunks(from, head, (f, t) => client.getLogs({ address: a.metamorph, event: TRANSFER, args, fromBlock: f, toBlock: t, strict: true }));
    const [inbound, outbound] = await Promise.all([read({ to: wallet }), read({ from: wallet })]);
    const logs = [...inbound, ...outbound].map((l) => ({ from: l.args.from, to: l.args.to, id: l.args.id, blockNumber: l.blockNumber, logIndex: l.logIndex }));
    // Another read may have moved the ledger on meanwhile; the fold keeps the later transfer either way.
    const now = ledgers.get(key) ?? seen;
    ledgers.set(key, { through: head > now.through ? head : now.through, fold: foldTransfers(logs, wallet, now.fold) });
  }
  return heldIds((ledgers.get(key) ?? seen).fold);
}

/// A card with what the page shows of it and what its stake needs.
export interface WalletCard {
  id: number;
  seat: number;
  round: number;
  edition: number;
  gilt: boolean;
  /// The mint's time, in seconds.
  mintedAt: number;
  /// The mint price paid, in PUPATE wei.
  paid: bigint;
  miner: Address;
  work: Hex;
  /// 0 in the cocoon, 1 emerged: read live (stageOf).
  stage: number;
  staked: boolean;
  /// The stake's weight as of its last settlement (1 a chrysalis, 2 a butterfly) and its debt; 0 unstaked.
  weight: number;
  debt: bigint;
}

type CardRow = readonly [number, number, number, boolean, number, bigint, Address, Hex];
type StakeRow = readonly [Address, number, bigint];

function cardOf(id: number, c: CardRow, stage: number, s: StakeRow): WalletCard {
  const [seat, round, edition, gilt, mintedAt, paid, miner, work] = c;
  const [staker, weight, debt] = s;
  const staked = !isAddressEqual(staker, zeroAddress);
  return { id, seat, round, edition, gilt, mintedAt, paid, miner, work, stage, staked, weight: staked ? weight : 0, debt: staked ? debt : 0n };
}

export interface WalletRead {
  cards: WalletCard[];
  /// pendingIMD(wallet): what is booked to the wallet already; any claim pays it.
  pending: bigint;
  accIMDPerWeight: bigint;
  /// IMD earned, not claimed: `pending` plus each staked card's share since its last settlement.
  earned: bigint;
}

/// The wallet's cards, oldest first, with their facts, live stages and stakes, and the IMD it earned and
/// has not claimed, read in one batch. A card the logs give but ownerOf denies (a node behind the logs, a
/// reorganised block) is left out until a later read agrees.
export async function walletCards(client: PublicClient, a: LiveAddresses, wallet: Address): Promise<WalletRead> {
  const ids = await heldBy(client, a, wallet);
  const t = token(a);
  const calls = [
    { ...t, functionName: "pendingIMD", args: [wallet] },
    { ...t, functionName: "accIMDPerWeight" },
    ...ids.flatMap((id) => {
      const n = BigInt(id);
      return [
        { ...t, functionName: "ownerOf", args: [n] },
        { ...t, functionName: "cards", args: [n] },
        { ...t, functionName: "stageOf", args: [n] },
        { ...t, functionName: "stakeOf", args: [n] },
      ];
    }),
  ] as ContractFunctionParameters[];
  const r = await client.multicall({ allowFailure: true, multicallAddress: MULTICALL3, contracts: calls });
  const [p, acc] = r;
  if (p.status !== "success") throw p.error;
  if (acc.status !== "success") throw acc.error;
  const cards: WalletCard[] = [];
  ids.forEach((id, i) => {
    const [owner, card, stage, stake] = r.slice(2 + 4 * i, 6 + 4 * i);
    if (owner.status !== "success" || card.status !== "success" || stage.status !== "success" || stake.status !== "success") return;
    if (!isAddressEqual(owner.result as Address, wallet)) return;
    cards.push(cardOf(id, card.result as CardRow, Number(stage.result), stake.result as StakeRow));
  });
  const pending = p.result as bigint;
  const accIMDPerWeight = acc.result as bigint;
  return { cards, pending, accIMDPerWeight, earned: earnedNotClaimed(pending, accIMDPerWeight, cards) };
}

/// IMD earned and not claimed: what is booked to the wallet (`pendingIMD(wallet)`), plus what each staked
/// card earned since its last settlement, (weight × accIMDPerWeight − debt) / 1e18, rounded down per card as
/// the contract's _settle books it, so it is exactly what unstaking or claiming those cards adds.
export function earnedNotClaimed(pending: bigint, accIMDPerWeight: bigint, stakes: readonly Pick<WalletCard, "staked" | "weight" | "debt">[]): bigint {
  let sum = pending;
  for (const s of stakes) if (s.staked) sum += (BigInt(s.weight) * accIMDPerWeight - s.debt) / ACC;
  return sum;
}

/// The same figure read on its own: pendingIMD(wallet) plus the unsettled share of those of `ids` the wallet
/// has staked (any other id adds nothing), in one batch.
export async function pendingIMD(client: PublicClient, a: LiveAddresses, wallet: Address, ids: readonly (number | bigint)[]): Promise<bigint> {
  const t = token(a);
  const calls = [
    { ...t, functionName: "pendingIMD", args: [wallet] },
    { ...t, functionName: "accIMDPerWeight" },
    ...ids.map((id) => ({ ...t, functionName: "stakeOf", args: [BigInt(id)] })),
  ] as ContractFunctionParameters[];
  const [p, acc, ...stakes] = await client.multicall({ allowFailure: false, multicallAddress: MULTICALL3, contracts: calls });
  const own = (stakes as StakeRow[]).filter(([staker]) => isAddressEqual(staker, wallet)).map(([, weight, debt]) => ({ staked: true, weight, debt }));
  return earnedNotClaimed(p as bigint, acc as bigint, own);
}

/// An IMD amount with four decimals, rounded down: the figure never shows more than a claim pays.
export function imd4(wei: bigint): string {
  const whole = wei / ACC;
  const frac = (wei % ACC) / 10n ** 14n;
  return `${whole.toLocaleString("en-US")}.${frac.toString().padStart(4, "0")}`;
}

/// A card's facts on their own, for its page: null when the id is not minted.
export interface CardFacts extends WalletCard {
  owner: Address | null;
}

export async function cardFacts(client: PublicClient, a: LiveAddresses, id: number | bigint): Promise<CardFacts | null> {
  const n = BigInt(id);
  const t = token(a);
  const [card, stage, stake, owner] = await client.multicall({
    allowFailure: true,
    multicallAddress: MULTICALL3,
    contracts: [
      { ...t, functionName: "cards", args: [n] },
      { ...t, functionName: "stageOf", args: [n] },
      { ...t, functionName: "stakeOf", args: [n] },
      { ...t, functionName: "ownerOf", args: [n] },
    ],
  });
  if (card.status !== "success") throw card.error;
  if (card.result[4] === 0) return null;
  if (stage.status !== "success") throw stage.error;
  if (stake.status !== "success") throw stake.error;
  return { ...cardOf(Number(n), card.result, stage.result, stake.result), owner: owner.status === "success" ? owner.result : null };
}

// ------------------------------------------------------------------ the three buttons

export type CardAction = "stake" | "unstake" | "claim";

/// What each button sends for a selection: Stake the selected cards not staked, Unstake the selected staked
/// ones, Claim IMD the selected staked ones; with none of those selected, Claim IMD sends claim([]) and is
/// paid what is booked to the wallet only.
export function actionIds(cards: readonly Pick<WalletCard, "id" | "staked">[], selected: ReadonlySet<number>): Record<CardAction, number[]> {
  const chosen = cards.filter((c) => selected.has(c.id));
  return {
    stake: chosen.filter((c) => !c.staked).map((c) => c.id),
    unstake: chosen.filter((c) => c.staked).map((c) => c.id),
    claim: chosen.filter((c) => c.staked).map((c) => c.id),
  };
}

/// What claim(ids) would pay: what is booked to the wallet plus the given staked cards' unsettled shares.
export function claimable(read: Pick<WalletRead, "cards" | "pending" | "accIMDPerWeight">, ids: readonly number[]): bigint {
  const pick = new Set(ids);
  return earnedNotClaimed(read.pending, read.accIMDPerWeight, read.cards.filter((c) => pick.has(c.id)));
}

/// stake(ids), unstake(ids) or claim(ids) through the visitor's wallet.
export function sendCards(write: WriteContract, a: LiveAddresses, action: CardAction, ids: readonly number[]): Promise<Hex> {
  return write({ address: a.metamorph, abi: metamorphAbi, functionName: action, args: [ids.map((id) => BigInt(id))] });
}

/// What a claim paid the wallet, from its receipt's Claimed log; null when the receipt has none.
export function claimedIn(receipt: { logs: readonly Log[] }, a: Pick<LiveAddresses, "metamorph">, wallet: Address): bigint | null {
  const own = receipt.logs.filter((l) => isAddressEqual(l.address, a.metamorph));
  const ev = parseEventLogs({ abi: metamorphAbi, logs: own, eventName: "Claimed" }).find((l) => isAddressEqual(l.args.staker, wallet));
  return ev ? ev.args.imd : null;
}

// ------------------------------------------------------------------ the images

/// The storage key of a card's image: one per id, stage and gilt.
export function imageKey(id: number | bigint, stage: number, gilt: boolean): string {
  return `${IMAGE_PREFIX}${id}:${stage}:${gilt}`;
}

/// The token URI's JSON as the page reads it: the image, and the attributes as text.
export interface CardJSON {
  name: string;
  description: string;
  image: string;
  attributes: { trait: string; value: string }[];
  /// The stage and gilt the JSON states (its Stage and Gilt attributes), null when it states none.
  stage: number | null;
  gilt: boolean | null;
}

/// Reads a token URI (lib/metamorph/mint.ts's tokenJSON decodes it): null unless it carries an image data URI.
export function cardJSON(uri: string): CardJSON | null {
  const j = tokenJSON(uri) as { name?: unknown; description?: unknown; image?: unknown; attributes?: unknown } | null;
  if (!j || typeof j !== "object" || typeof j.image !== "string" || !j.image.startsWith("data:image/")) return null;
  const attributes = Array.isArray(j.attributes)
    ? j.attributes.flatMap((x: unknown) => {
        const t = x as { trait_type?: unknown; value?: unknown } | null;
        return t && typeof t.trait_type === "string" && (typeof t.value === "string" || typeof t.value === "number") ? [{ trait: t.trait_type, value: String(t.value) }] : [];
      })
    : [];
  const stage = attributes.find((x) => x.trait === "Stage")?.value;
  const gilt = attributes.find((x) => x.trait === "Gilt")?.value;
  return {
    name: typeof j.name === "string" ? j.name : "",
    description: typeof j.description === "string" ? j.description : "",
    image: j.image,
    attributes,
    stage: stage === "Butterfly" ? 1 : stage === "Chrysalis" ? 0 : null,
    gilt: gilt === "Yes" ? true : gilt === "No" ? false : null,
  };
}

const memory = new Map<string, string>();
const reads = new Map<string, Promise<string | null>>();

/// localStorage, or null where there is none or it is refused (reading the property can throw).
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function keep(k: string, src: string): void {
  memory.delete(k);
  memory.set(k, src);
  if (memory.size > MEMORY_IMAGES) {
    const oldest = memory.keys().next().value;
    if (oldest !== undefined) memory.delete(oldest);
  }
}

/// A card's image when it was read before, from memory or localStorage; null when it must be read. An entry
/// in storage names the token it came from, so a card of another deployment with the same id never shows.
export function cachedImage(a: Pick<LiveAddresses, "chainId" | "metamorph">, id: number | bigint, stage: number, gilt: boolean): string | null {
  const key = imageKey(id, stage, gilt);
  const tag = scope(a);
  const near = memory.get(`${tag}|${key}`);
  if (near) {
    keep(`${tag}|${key}`, near);
    return near;
  }
  try {
    const v = storage()?.getItem(key);
    if (v && v.startsWith(`${tag} data:image/`)) {
      const src = v.slice(tag.length + 1);
      keep(`${tag}|${key}`, src);
      return src;
    }
  } catch {
    // Storage refused: the image is read again.
  }
  return null;
}

/// Keeps a card's image in memory and, when it can, in localStorage. A full storage makes room once (other
/// deployments' images first, else half of this token's) and tries again; then the memory copy is enough.
export function rememberImage(a: Pick<LiveAddresses, "chainId" | "metamorph">, id: number | bigint, stage: number, gilt: boolean, src: string): void {
  const key = imageKey(id, stage, gilt);
  const tag = scope(a);
  keep(`${tag}|${key}`, src);
  const s = storage();
  if (!s) return;
  const value = `${tag} ${src}`;
  try {
    s.setItem(key, value);
    return;
  } catch {
    // Full or refused: room is made below.
  }
  try {
    const ours: string[] = [];
    const others: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k?.startsWith(IMAGE_PREFIX)) (s.getItem(k)?.startsWith(`${tag} `) ? ours : others).push(k);
    }
    for (const k of others.length ? others : ours.slice(0, Math.ceil(ours.length / 2))) s.removeItem(k);
    s.setItem(key, value);
  } catch {
    // Still refused: the memory copy serves this visit.
  }
}

/// A few tokenURI reads at a time; a finished read hands its place to the next one waiting.
let reading = 0;
const waiting: (() => void)[] = [];
async function oneOfFew<T>(read: () => Promise<T>): Promise<T> {
  if (reading < IMAGE_READS) reading++;
  else await new Promise<void>((go) => waiting.push(go));
  try {
    return await read();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else reading--;
  }
}

/// A card's image: from the cache, or read through the token's tokenURI (one read per card however many
/// tiles ask at once). It is kept under the stage and gilt its own JSON states, which the chain read with the
/// image, so a card that emerged between the stage's read and this one is kept as emerged.
export function tokenImage(client: PublicClient, a: LiveAddresses, id: number | bigint, stage: number, gilt: boolean): Promise<string | null> {
  const hit = cachedImage(a, id, stage, gilt);
  if (hit) return Promise.resolve(hit);
  const k = `${scope(a)}|${imageKey(id, stage, gilt)}`;
  const running = reads.get(k);
  if (running) return running;
  const read = oneOfFew(() => client.readContract({ ...token(a), functionName: "tokenURI", args: [BigInt(id)] }))
    .then((uri) => {
      const card = cardJSON(uri);
      if (!card) return null;
      rememberImage(a, id, card.stage ?? stage, card.gilt ?? gilt, card.image);
      return card.image;
    })
    .finally(() => reads.delete(k));
  reads.set(k, read);
  return read;
}

/// A card's whole JSON, for its page (the attributes are not cached; the image is kept as tokenImage keeps it).
export async function tokenCard(client: PublicClient, a: LiveAddresses, id: number | bigint): Promise<CardJSON | null> {
  const uri = await client.readContract({ ...token(a), functionName: "tokenURI", args: [BigInt(id)] });
  const card = cardJSON(uri);
  if (card && card.stage !== null && card.gilt !== null) rememberImage(a, id, card.stage, card.gilt, card.image);
  return card;
}

// ------------------------------------------------------------------ the gallery and the leaderboard

/// A minted card as its Minted log tells it.
export interface MintedRow {
  id: number;
  seat: number;
  miner: Address;
  gilt: boolean;
  epoch: number;
  block: bigint;
}

/// Per token: every Minted log through the last block read, by id.
const mintLogs = new Map<string, { through: bigint; rows: Map<number, MintedRow> }>();

/// Every minted card, newest first, from the Minted logs; a read takes only the blocks not seen yet.
export async function mintedCards(client: PublicClient, a: LiveAddresses): Promise<MintedRow[]> {
  const key = scope(a);
  const start = BigInt(a.fromBlock);
  const head = await client.getBlockNumber({ cacheTime: 0 });
  const seen = mintLogs.get(key) ?? { through: start - 1n, rows: new Map<number, MintedRow>() };
  if (head > seen.through) {
    const logs = await inChunks(nextFrom(seen.through, start), head, (f, t) =>
      client.getLogs({ address: a.metamorph, event: MINTED, fromBlock: f, toBlock: t, strict: true }),
    );
    const now = mintLogs.get(key) ?? seen;
    const rows = new Map(now.rows);
    for (const l of logs) {
      const id = Number(l.args.id);
      rows.set(id, { id, seat: Number(l.args.seat), miner: l.args.miner, gilt: l.args.gilt, epoch: l.args.epoch, block: l.blockNumber });
    }
    mintLogs.set(key, { through: head > now.through ? head : now.through, rows });
  }
  return [...(mintLogs.get(key) ?? seen).rows.values()].sort((x, y) => y.id - x.id);
}

/// The live stages of some cards (a gallery page), by id; a card whose read failed is left out.
export async function stagesOf(client: PublicClient, a: LiveAddresses, ids: readonly number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!ids.length) return out;
  const r = await client.multicall({
    allowFailure: true,
    multicallAddress: MULTICALL3,
    contracts: ids.map((id) => ({ ...token(a), functionName: "stageOf" as const, args: [BigInt(id)] as const })),
  });
  ids.forEach((id, i) => {
    const x = r[i];
    if (x.status === "success") out.set(id, x.result);
  });
  return out;
}

/// A miner on the leaderboard: the cards they minted, how many came out gilt, and their newest card's id.
export interface Leader {
  miner: Address;
  cards: number;
  gilt: number;
  newest: number;
}

/// The miners by cards minted; on equal counts the one whose newest card is newer comes first.
export function leaderboard(rows: readonly Pick<MintedRow, "id" | "miner" | "gilt">[]): Leader[] {
  const by = new Map<string, Leader>();
  for (const r of rows) {
    const k = r.miner.toLowerCase();
    const x = by.get(k) ?? { miner: r.miner, cards: 0, gilt: 0, newest: 0 };
    x.cards++;
    if (r.gilt) x.gilt++;
    if (r.id > x.newest) x.newest = r.id;
    by.set(k, x);
  }
  return [...by.values()].sort((x, y) => y.cards - x.cards || y.newest - x.newest);
}
