// Metamorph MD's duties: the four calls the mine leaves to anyone, made by the keeper on every tick after
// the vault's own steps (lib/actions.mjs) when the addresses file names the token (`metamorph`):
//
//   noteSeats    noteSeat(seat), one transaction per seat the vault holds that the token has not noted
//   forgetSeats  forgetSeat(seat), one per noted seat the vault no longer holds
//   convert      convert() when the pot holds CONVERT_PRICES / 5 mint prices of PUPATE or ETH waits in the
//                ETH pot, CONVERT_SPACING blocks after the last conversion; the gas limit is the estimate
//                plus 1,000,000, and the caller's 0.5% of the IMD bought is the keeper's
//   poke         poke(ids) for the staked cards whose stage no longer matches their weight (a chrysalis
//                weighs 1, a butterfly 2), 50 cards per transaction
//
// "Holds" is the token's own test (`_vaultHolds`): on Cocoon's books and in Cocoon's wallet. The candidates
// come from the replay of Cocoon's seat logs and from the noted list, and readState (lib/state.mjs)
// confirms each one on chain in the same read, so a seat sold and not yet settled, or bought earlier in
// this very tick, is decided by what the chain says now and not by the logs alone. Every call goes through
// tx.run: an eth_call first (a revert such as SeatNotHeld or SeatHeld is logged by its name and skipped),
// then the gas price cap and the sequential nonce. The *Decision functions are pure on the state `s`; the
// status feed (lib/status.mjs) calls the same ones, as it does for the vault's steps.
import { formatUnits, isAddressEqual, parseEventLogs } from 'viem';
import { metamorphAbi } from './abi.mjs';
import { fmtEth, fmtTokens, log } from './log.mjs';

/// The padding over the estimate a conversion is sent with: the 1,000,000 the mine page also adds to a mint
/// that runs one (CONVERT_GAS and the margin the contract's CONVERT_BACKOFF note asks for).
export const CONVERT_PAD = 1_000_000n;
/// The keeper converts at a fifth of a mint's threshold, CONVERT_PRICES / 5 mint prices (20 of 100), so at
/// full pace the pot turns into IMD about hourly instead of waiting for a mint deep enough to do it.
export const CONVERT_SHARE = 5n;
/// Staked cards per poke transaction.
export const POKE_BATCH = 50;

const idle = (note) => ({ acted: false, note });
const acted = (res) => ({ acted: res.status === 'sent' || res.status === 'dry', res, note: '' });
const s1 = (n) => (BigInt(n) === 1n ? '' : 's');

/** "#3 #7", the first ten and a count past them. */
function tags(ids) {
  const shown = ids
    .slice(0, 10)
    .map((id) => `#${id}`)
    .join(' ');
  return ids.length > 10 ? `${shown} … (${ids.length} in all)` : shown;
}

/** 0.012345 IMD: 18 decimals trimmed to `places`, thousands separated. */
function fmtImd(wei, places = 6) {
  const [whole, frac = ''] = formatUnits(BigInt(wei), 18).split('.');
  const cut = frac.slice(0, places).replace(/0+$/, '');
  return `${BigInt(whole).toLocaleString('en-US')}${cut ? `.${cut}` : ''} IMD`;
}

/** Why a duty cannot be decided: no token on this chain, or its state could not be read this tick. */
function unread(step, s) {
  if (!s.mine) return { ready: false, unread: true, why: `${step}: no Metamorph MD on this chain` };
  if (s.mine.error) return { ready: false, unread: true, why: `${step}: the mine could not be read (${s.mine.error})` };
  return null;
}

// ------------------------------------------------------------------ noteSeats

/** noteSeat is due for every seat the vault holds, confirmed on chain, that the token has not noted. */
export function noteSeatsDecision(cfg, s) {
  const u = unread('noteSeats', s);
  if (u) return { ...u, due: [] };
  const m = s.mine;
  const noted = new Set(m.noted.map(String));
  const due = m.held.filter((id) => !noted.has(String(id)));
  if (due.length === 0) {
    return { ready: false, why: m.held.length ? `noteSeats: every seat the vault holds is noted (${tags(m.held)})` : 'noteSeats: the vault holds no seat', due };
  }
  return { ready: true, why: `noteSeats: ${tags(due)} held by the vault, not noted`, due };
}

export async function noteSeats(ctx, s) {
  const d = noteSeatsDecision(ctx.cfg, s);
  if (!d.ready) return idle(d.why); // the one duty that carries an unreadable mine's reason to the idle line
  const md = ctx.a.metamorph;
  const did = await each(ctx, d.due, (id) => [`noteSeat #${id}`, { address: md, abi: metamorphAbi, functionName: 'noteSeat', args: [id] }]);
  return did ? { acted: true, note: '' } : idle(`noteSeats: ${d.due.length} seat${s1(d.due.length)} to note, none went through`);
}

// ------------------------------------------------------------------ forgetSeats

/** forgetSeat is due for every noted seat the vault no longer holds, confirmed on chain. */
export function forgetSeatsDecision(cfg, s) {
  const u = unread('forgetSeats', s);
  if (u) return { ...u, due: [] };
  const m = s.mine;
  const held = new Set(m.held.map(String));
  const due = m.noted.filter((id) => !held.has(String(id)));
  if (due.length === 0) {
    return { ready: false, why: m.noted.length ? `forgetSeats: every noted seat is still the vault's (${tags(m.noted)})` : 'forgetSeats: no seat noted', due };
  }
  return { ready: true, why: `forgetSeats: ${tags(due)} noted, no longer held by the vault`, due };
}

export async function forgetSeats(ctx, s) {
  const d = forgetSeatsDecision(ctx.cfg, s);
  if (!d.ready) return idle(d.unread ? '' : d.why);
  const md = ctx.a.metamorph;
  const did = await each(ctx, d.due, (id) => [`forgetSeat #${id}`, { address: md, abi: metamorphAbi, functionName: 'forgetSeat', args: [id] }]);
  return did ? { acted: true, note: '' } : idle(`forgetSeats: ${d.due.length} seat${s1(d.due.length)} to forget, none went through`);
}

// ------------------------------------------------------------------ convert

/** The pot the keeper converts at: CONVERT_PRICES / CONVERT_SHARE mint prices of PUPATE. */
export const convertThreshold = (m) => (m.mintPrice * m.convertPrices) / CONVERT_SHARE;

/**
 * convert is due when the pot holds at least CONVERT_PRICES / 5 mint prices or the ETH pot is not empty,
 * and CONVERT_SPACING blocks have passed since lastConvertBlock, counted at the block the transaction
 * would land in (as the burn's spacing is).
 */
export function convertDecision(cfg, s) {
  const u = unread('convert', s);
  if (u) return u;
  const m = s.mine;
  const threshold = convertThreshold(m);
  const potDue = m.pot >= threshold;
  const ethDue = m.ethPot !== 0n;
  if (!potDue && !ethDue) {
    if (m.pot === 0n) return { ready: false, why: 'convert: nothing in the pot' };
    return { ready: false, why: `convert: pot ${fmtTokens(m.pot)} < ${fmtTokens(threshold)} (${m.convertPrices / CONVERT_SHARE} mint prices)` };
  }
  const next = m.lastConvertBlock + m.convertSpacing;
  const landing = s.block.number + 1n; // the block the transaction would land in
  if (landing < next) return { ready: false, tooSoon: true, why: `convert: TooSoon (${next - landing} block${s1(next - landing)})` };
  const pot = potDue ? `pot ${fmtTokens(m.pot)} >= ${fmtTokens(threshold)}` : `pot ${fmtTokens(m.pot)}`;
  const eth = ethDue ? `, ethPot ${fmtEth(m.ethPot)}` : '';
  return { ready: true, why: `convert: ${pot}${eth}`, label: `convert (pot ${fmtTokens(m.pot)}${eth})` };
}

export async function convertPot(ctx, s) {
  const d = convertDecision(ctx.cfg, s);
  if (!d.ready) {
    if (d.unread) return idle('');
    if (!d.tooSoon) return idle(d.why);
    log(`skip ${d.why}`);
    return idle('');
  }
  const res = await ctx.tx.run(d.label, { address: ctx.a.metamorph, abi: metamorphAbi, functionName: 'convert' }, { padGas: CONVERT_PAD });
  if (res.status === 'sent') {
    const line = convertedLine(res.receipt, ctx.a.metamorph);
    if (line) log(line);
  }
  return acted(res);
}

/** What a conversion's receipt says (its Converted event), for the log; null without one. */
export function convertedLine(receipt, metamorph) {
  const ours = receipt.logs.filter((l) => isAddressEqual(l.address, metamorph));
  const [ev] = parseEventLogs({ abi: metamorphAbi, eventName: 'Converted', logs: ours });
  if (!ev) return null;
  const { pupateSold, ethBought, imdBought, reward } = ev.args;
  return `converted: sold ${fmtTokens(pupateSold)} for ${fmtEth(ethBought, 6)}, bought ${fmtImd(imdBought)} for the stakers, ${fmtImd(reward)} of it the caller's reward`;
}

// ------------------------------------------------------------------ poke

/** poke is due for every staked card whose stage no longer matches its weight: stage 0 weighs 1, stage 1 weighs 2. */
export function pokeDecision(cfg, s) {
  const u = unread('poke', s);
  if (u) return { ...u, due: [], batches: [] };
  const m = s.mine;
  if (m.stakes.length === 0) return { ready: false, why: 'poke: no card staked', due: [], batches: [] };
  const due = m.stakes.filter((x) => x.stage + 1 !== x.weight).map((x) => x.id);
  if (due.length === 0) {
    return { ready: false, why: `poke: ${m.stakes.length} staked card${s1(m.stakes.length)}, each at the weight of its stage`, due, batches: [] };
  }
  const batches = [];
  for (let i = 0; i < due.length; i += POKE_BATCH) batches.push(due.slice(i, i + POKE_BATCH));
  return { ready: true, why: `poke: ${tags(due)} staked at a weight their stage no longer has`, due, batches };
}

export async function poke(ctx, s) {
  const d = pokeDecision(ctx.cfg, s);
  if (!d.ready) return idle(d.unread ? '' : d.why);
  const md = ctx.a.metamorph;
  const did = await each(ctx, d.batches, (ids) => [
    `poke ${tags(ids)} (${ids.length} card${s1(ids.length)})`,
    { address: md, abi: metamorphAbi, functionName: 'poke', args: [ids] },
  ]);
  return did ? { acted: true, note: '' } : idle(`poke: ${d.due.length} card${s1(d.due.length)} to reweigh, none went through`);
}

// ------------------------------------------------------------------ helpers

/**
 * One transaction per item, in order, through tx.run; `of(item)` gives [label, call]. A revert is logged
 * and skipped. A gas price above the cap, or no key, holds for the rest of the list too, so it stops there.
 * Returns whether anything went out (or, in a dry run, would have).
 */
async function each(ctx, items, of) {
  let did = false;
  for (const item of items) {
    const [label, call] = of(item);
    const res = await ctx.tx.run(label, call);
    if (res.status === 'sent' || res.status === 'dry') did = true;
    else if (res.status === 'waiting' || res.status === 'nokey') break;
  }
  return did;
}
