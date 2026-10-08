// One line per decision, ISO-timestamped, with the tick number as a prefix. Nothing here ever
// receives a key or an RPC URL: callers pass addresses, amounts and names only.
import { formatEther, formatGwei } from 'viem';

let prefix = '';

export function setTick(n) {
  prefix = n === null || n === undefined ? '' : `[tick ${n}] `;
}

export function log(message) {
  console.log(`${new Date().toISOString()} ${prefix}${message}`);
}

export function warn(message) {
  console.error(`${new Date().toISOString()} ${prefix}WARN ${message}`);
}

/** 0.0988 ETH style, trimmed to `places` decimals (default 4), never scientific notation. */
export function fmtEth(wei, places = 4) {
  const s = formatEther(BigInt(wei));
  const [whole, frac = ''] = s.split('.');
  const cut = frac.slice(0, places).replace(/0+$/, '');
  return `${whole}${cut ? '.' + cut : ''} ETH`;
}

export function fmtGwei(wei) {
  const s = formatGwei(BigInt(wei));
  const [whole, frac = ''] = s.split('.');
  const cut = frac.slice(0, 3).replace(/0+$/, '');
  return `${whole}${cut ? '.' + cut : ''} gwei`;
}

/** Whole-token figure with thousands separators (18 decimals). */
export function fmtTokens(wei, symbol = 'PUPATE') {
  const whole = BigInt(wei) / 10n ** 18n;
  return `${whole.toLocaleString('en-US')} ${symbol}`;
}

export function short(address) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '-';
}

/** "5h12m" / "48s" / "-3m" for a signed number of seconds. */
export function fmtDuration(seconds) {
  const n = Number(seconds);
  const sign = n < 0 ? '-' : '';
  const s = Math.abs(Math.trunc(n));
  if (s < 60) return `${sign}${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${sign}${m}m${s % 60 ? (s % 60) + 's' : ''}`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${sign}${h}h${m % 60 ? (m % 60) + 'm' : ''}`;
  return `${sign}${Math.floor(h / 24)}d${h % 24 ? (h % 24) + 'h' : ''}`;
}

/** JSON with bigints as decimal strings. */
export function jsonSafe(value, space) {
  return JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v), space);
}
