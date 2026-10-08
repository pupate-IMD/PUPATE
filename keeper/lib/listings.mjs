// Seaport orders: Cocoon's own two listings per seat (a port of src/cocoon/SeatListing.sol, needed
// to tell whether a held seat has sold), the client-side copy of Cocoon._checkOrder, and the two
// listing sources the keeper buys from: a JSON file (the fork test) and OpenSea's API v2 (UNTESTED
// here: no key in this environment).
import { readFileSync } from 'node:fs';
import { encodeAbiParameters, getAddress, isAddressEqual, keccak256, zeroAddress, zeroHash } from 'viem';
import { ItemType, OrderType } from './abi.mjs';

export const BPS = 10_000n;
export const TAIL = 3650n * 86_400n;
/// OpenSea's signed zone: its FULL_RESTRICTED orders need extraData from OpenSea's fulfilment
/// endpoint, which Cocoon's buySeat cannot supply (it passes the order as given).
const OPENSEA_SIGNED_ZONE = '0x000056F7000000EcE9003ca63978907a00FFD100';

// ------------------------------------------------------------------ Cocoon's own orders

/** keccak256(abi.encode(tokenId, round, index)), as SeatListing.salt. */
export function seatSalt(tokenId, round, index) {
  return BigInt(
    keccak256(
      encodeAbiParameters([{ type: 'uint256' }, { type: 'uint16' }, { type: 'uint256' }], [BigInt(tokenId), Number(round), BigInt(index)]),
    ),
  );
}

export const startPrice = (t) => (BigInt(t.cost) * BigInt(t.startX)) / BPS;
export const endPrice = (t) => (BigInt(t.cost) * BigInt(t.endX)) / BPS;

/**
 * SeatListing.parameters. `terms` = { cost, startX, endX, decay, boughtAt, round }; index 0 is the
 * falling order, 1 the flat ten-year tail.
 */
export function seatParameters(offerer, collection, tokenId, terms, index) {
  const start = startPrice(terms);
  const end = endPrice(terms);
  const boughtAt = BigInt(terms.boughtAt);
  const decay = BigInt(terms.decay);
  const falling = Number(index) === 0;
  const startAmount = falling ? start : end;
  const endAmount = end;
  const startTime = falling ? boughtAt : boughtAt + decay;
  const endTime = falling ? boughtAt + decay : boughtAt + decay + TAIL;
  return {
    offerer: getAddress(offerer),
    zone: zeroAddress,
    offer: [{ itemType: ItemType.ERC721, token: getAddress(collection), identifierOrCriteria: BigInt(tokenId), startAmount: 1n, endAmount: 1n }],
    consideration: [
      { itemType: ItemType.NATIVE, token: zeroAddress, identifierOrCriteria: 0n, startAmount, endAmount, recipient: getAddress(offerer) },
    ],
    orderType: OrderType.FULL_OPEN,
    startTime,
    endTime,
    zoneHash: zeroHash,
    salt: seatSalt(tokenId, terms.round, index),
    conduitKey: zeroHash,
    totalOriginalConsiderationItems: 1n,
  };
}

/** The two orders Cocoon validates (SeatListing.orders). */
export function seatOrders(offerer, collection, tokenId, terms) {
  return [0, 1].map((i) => ({ parameters: seatParameters(offerer, collection, tokenId, terms, i), signature: '0x' }));
}

/** OrderComponents = OrderParameters with the offerer's counter in place of the item count. */
export function toComponents(p, counter) {
  const { totalOriginalConsiderationItems, ...rest } = p;
  return { ...rest, counter: BigInt(counter) };
}

/** The same two orders as OrderComponents (SeatListing.components), for getOrderHash / cancel. */
export function seatComponents(offerer, collection, tokenId, terms, counter) {
  return [0, 1].map((i) => toComponents(seatParameters(offerer, collection, tokenId, terms, i), counter));
}

/** The falling order's price at `now` (Seaport's linear interpolation, rounded up like Seaport). */
export function currentPrice(p, now) {
  const c = p.consideration.reduce(
    (acc, item) => ({ start: acc.start + item.startAmount, end: acc.end + item.endAmount }),
    { start: 0n, end: 0n },
  );
  if (c.start === c.end) return c.start;
  const t = BigInt(now);
  if (t <= p.startTime) return c.start;
  if (t >= p.endTime) return c.end;
  const elapsed = t - p.startTime;
  const duration = p.endTime - p.startTime;
  const remaining = duration - elapsed;
  // Seaport rounds up when the price is falling.
  const total = c.start * remaining + c.end * elapsed;
  return (total + duration - 1n) / duration;
}

// ------------------------------------------------------------------ Cocoon._checkOrder, client side

/** The highest price the order can ask: the sum over consideration items of max(start, end). */
export function orderPrice(p) {
  return p.consideration.reduce((sum, c) => sum + (c.startAmount > c.endAmount ? c.startAmount : c.endAmount), 0n);
}

/**
 * Every rule of Cocoon._checkOrder plus Seaport's time window, so a bad listing is dropped before
 * it costs an eth_call. Returns { ok, reason, tokenId, price }.
 */
export function checkOrder(order, { collection, cocoon, floorWei, fresh, toleranceBps, heldIds = new Set(), now }) {
  const p = order.parameters;
  const bad = (reason) => ({ ok: false, reason, tokenId: null, price: 0n });
  if (!p || !Array.isArray(p.offer) || !Array.isArray(p.consideration)) return bad('BadOrder: malformed');
  if (p.offer.length !== 1 || p.consideration.length === 0) return bad('BadOrder: offer/consideration count');
  if (BigInt(p.totalOriginalConsiderationItems) !== BigInt(p.consideration.length)) return bad('BadOrder: consideration length != original');
  if (BigInt(order.numerator ?? 1n) !== 1n || BigInt(order.denominator ?? 1n) !== 1n) return bad('BadOrder: partial fill fraction');
  if (p.orderType !== OrderType.FULL_OPEN && p.orderType !== OrderType.FULL_RESTRICTED) return bad('BadOrder: order type');
  const item = p.offer[0];
  if (item.itemType !== ItemType.ERC721 || !isAddressEqual(item.token, collection) || item.startAmount !== 1n || item.endAmount !== 1n) {
    return bad('BadOrder: offer item');
  }
  const tokenId = item.identifierOrCriteria;
  if (heldIds.has(tokenId.toString())) return bad('AlreadyHeld');
  let price = 0n;
  for (const c of p.consideration) {
    if (c.itemType !== ItemType.NATIVE || isAddressEqual(c.recipient, cocoon)) return bad('BadOrder: consideration item');
    if (c.startAmount === 0n || c.endAmount === 0n) return bad('BadOrder: zero consideration');
    price += c.startAmount > c.endAmount ? c.startAmount : c.endAmount;
  }
  if (!fresh) return { ok: false, reason: 'FloorNotFresh', tokenId, price };
  if (price > (BigInt(floorWei) * (BPS + BigInt(toleranceBps))) / BPS) return { ok: false, reason: 'PriceAboveFloor', tokenId, price };
  if (now !== undefined) {
    const t = BigInt(now);
    if (t < p.startTime || t >= p.endTime) return { ok: false, reason: 'InvalidTime', tokenId, price };
  }
  if (p.orderType === OrderType.FULL_RESTRICTED && isAddressEqual(p.zone, OPENSEA_SIGNED_ZONE)) {
    return { ok: false, reason: 'zone needs extraData', tokenId, price };
  }
  return { ok: true, reason: '', tokenId, price };
}

/** An AdvancedOrder for Cocoon.buySeat: the whole order, no criteria, no extra data. */
export function toAdvancedOrder(listing) {
  return { parameters: listing.parameters, numerator: 1n, denominator: 1n, signature: listing.signature || '0x', extraData: '0x' };
}

// ------------------------------------------------------------------ normalisation

const big = (v) => (typeof v === 'bigint' ? v : BigInt(String(v)));
const small = (v) => Number(v);
const hex32 = (v) => {
  if (!v) return zeroHash;
  const s = String(v).toLowerCase();
  return s.startsWith('0x') ? `0x${s.slice(2).padStart(64, '0')}` : `0x${BigInt(s).toString(16).padStart(64, '0')}`;
};

/** OrderParameters from JSON of any origin (strings or numbers), typed the way viem encodes them. */
export function normalizeParameters(raw) {
  return {
    offerer: getAddress(raw.offerer),
    zone: getAddress(raw.zone || zeroAddress),
    offer: raw.offer.map((o) => ({
      itemType: small(o.itemType),
      token: getAddress(o.token),
      identifierOrCriteria: big(o.identifierOrCriteria),
      startAmount: big(o.startAmount),
      endAmount: big(o.endAmount),
    })),
    consideration: raw.consideration.map((c) => ({
      itemType: small(c.itemType),
      token: getAddress(c.token || zeroAddress),
      identifierOrCriteria: big(c.identifierOrCriteria ?? 0),
      startAmount: big(c.startAmount),
      endAmount: big(c.endAmount),
      recipient: getAddress(c.recipient),
    })),
    orderType: small(raw.orderType),
    startTime: big(raw.startTime),
    endTime: big(raw.endTime),
    zoneHash: hex32(raw.zoneHash),
    salt: big(raw.salt),
    conduitKey: hex32(raw.conduitKey),
    totalOriginalConsiderationItems: big(raw.totalOriginalConsiderationItems ?? raw.consideration.length),
  };
}

// ------------------------------------------------------------------ sources

/** A JSON array of { parameters, signature } (signature "0x" for an order validated on-chain). */
export function listingsFromFile(file) {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const arr = Array.isArray(json) ? json : json.listings || json.orders || [];
  return arr.map((o, i) => ({
    source: `file#${i}`,
    parameters: normalizeParameters(o.parameters ?? o.protocol_data?.parameters ?? o),
    signature: o.signature ?? o.protocol_data?.signature ?? '0x',
  }));
}

/**
 * OpenSea API v2: the collection's Seaport listings, cheapest first. UNTESTED in this environment
 * (no key). Only Seaport 1.6 orders are kept; OpenSea's numbers are strings and its `counter` is
 * dropped (Cocoon takes OrderParameters, not OrderComponents).
 */
export async function listingsFromOpenSea({ apiKey, api, chain, collection, seaport, limit = 50, fetchImpl = fetch }) {
  if (!apiKey) throw new Error('OPENSEA_API_KEY is not set');
  const url =
    `${api}/api/v2/orders/${chain}/seaport/listings?asset_contract_address=${collection}` +
    `&order_by=eth_price&order_direction=asc&limit=${limit}`;
  const res = await fetchImpl(url, { headers: { accept: 'application/json', 'x-api-key': apiKey } });
  if (!res.ok) throw new Error(`OpenSea ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  const out = [];
  for (const o of body.orders || []) {
    const pd = o.protocol_data;
    if (!pd?.parameters) continue;
    if (o.protocol_address && !isAddressEqual(o.protocol_address, seaport)) continue;
    if (o.cancelled || o.finalized || o.side === 'bid') continue;
    out.push({
      source: `opensea:${o.order_hash || ''}`,
      parameters: normalizeParameters(pd.parameters),
      signature: pd.signature || '0x',
      currentPrice: o.current_price ? BigInt(o.current_price) : undefined,
    });
  }
  return out;
}
