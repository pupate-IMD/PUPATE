// The simulated protocol behind the preview. The same rules as Cocoon and PupateHook, run against
// sample figures inside the page, so the flows can be judged before anything is deployed. Nothing
// here sends a transaction. The live site replaces this module with contract reads and writes.

export const RATE = 70_400_000; // PUPATE per ETH at the pool price (sample)
export const SUPPLY = 1_000_000_000;
export const LP_FEE = 0.003;
export const STANDING_TAX = 0.06;
export const LAUNCH_TAX = 0.99;
export const LAUNCH_MINUTES = 93;
export const REWARD = 0.005;
export const IMPACT_CAP_ETH = 0.3; // what the 5% price-impact limit lets one burn spend at this depth
export const HALF_LIFE_H = 2;
export const SHARE = { strategy: 0.85, developer: 0.1, imd: 0.05 } as const;

export type SeatStatus = "working" | "idle";

export interface Seat {
  id: number;
  cost: number;
  day: number;
  jobs: number;
  status: SeatStatus;
}

export interface Sale {
  id: number;
  bought: number;
  sold: number;
  held: number;
  burned: number;
}

export interface Auction {
  token: string;
  lot: number;
  start: number;
  ageH: number;
}

export interface LogEntry {
  id: number;
  when: string;
  text: string;
}

export interface HistoryPoint {
  day: number;
  burned: number;
  seats: number;
}

export interface Caller {
  who: string;
  flush: number;
  buy: number;
  burn: number;
  reward: number;
}

export interface SimState {
  preset: "steady" | "launch";
  launchMinute: number;
  day: number;
  floor: number;
  taxCollected: number;
  hookWaiting: number;
  seatPot: number;
  burnPot: number;
  dev: number;
  imdBurn: number;
  burned: number;
  imdBurned: number;
  harvested: number;
  seats: Seat[];
  sold: Sale[];
  auction: Auction | null;
  burnCooldown: number;
  wallet: string | null;
  buying: boolean;
  toast: { id: number; text: string } | null;
  log: LogEntry[];
  history: HistoryPoint[];
  callers: Caller[];
}

const seat = (id: number, cost: number, day: number, jobs: number, status: SeatStatus): Seat => ({
  id,
  cost,
  day,
  jobs,
  status,
});

// Days 0 to 22 of the sample run: burns arrive in steps when seats sell, seats held climbs.
function sampleHistory(): HistoryPoint[] {
  const seatsByDay = [0, 0, 1, 1, 2, 2, 3, 3, 3, 4, 4, 5, 5, 4, 5, 6, 6, 5, 6, 6, 7, 6, 6];
  const burnDays: Record<number, number> = { 3: 0.9, 6: 1.1, 9: 1.3, 13: 4.31, 17: 4.21, 21: 3.96 };
  let burned = 0;
  return seatsByDay.map((seats, day) => {
    burned += (burnDays[day] ?? 0.035) * 1_000_000 * (day in burnDays ? 1 : 0.6);
    return { day, burned: Math.round(burned), seats };
  });
}

export function preset(name: "steady" | "launch"): SimState {
  const base = { wallet: null, buying: true, toast: null, burnCooldown: 0, log: [] as LogEntry[] };
  if (name === "launch") {
    return {
      ...base,
      preset: "launch",
      launchMinute: 12,
      day: 0,
      floor: 2.74,
      taxCollected: 3.9,
      hookWaiting: 0.42,
      seatPot: 2.31,
      burnPot: 0.99,
      dev: 0.39,
      imdBurn: 0.195,
      burned: 0,
      imdBurned: 0,
      harvested: 0,
      seats: [],
      sold: [],
      auction: null,
      history: [],
      callers: [{ who: "0x71c4…0be2", flush: 3, buy: 0, burn: 0, reward: 0 }],
    };
  }
  return {
    ...base,
    preset: "steady",
    launchMinute: 0,
    day: 23,
    floor: 2.74,
    taxCollected: 61.2,
    hookWaiting: 0.08,
    seatPot: 1.95,
    burnPot: 0.41,
    dev: 6.12,
    imdBurn: 3.06,
    burned: 12_480_000,
    imdBurned: 312,
    harvested: 0.37,
    seats: [
      seat(1733, 2.84, 0, 3, "working"),
      seat(882, 2.76, 2, 17, "working"),
      seat(1376, 2.8, 6, 41, "working"),
      seat(410, 2.72, 9, 0, "idle"),
      seat(1540, 2.91, 11, 66, "working"),
      seat(97, 2.66, 14, 88, "working"),
    ],
    sold: [
      { id: 231, bought: 2.58, sold: 3.41, held: 5, burned: 4_310_000 },
      { id: 1105, bought: 2.7, sold: 3.24, held: 8, burned: 4_210_000 },
      { id: 644, bought: 2.61, sold: 3.09, held: 10, burned: 3_960_000 },
    ],
    auction: { token: "FREE1376", lot: 4120, start: 1, ageH: 16.3 },
    history: sampleHistory(),
    callers: [
      { who: "0x71c4…0be2", flush: 212, buy: 5, burn: 31, reward: 0.1184 },
      { who: "0xa90e…77d1", flush: 64, buy: 3, burn: 12, reward: 0.0621 },
      { who: "0x3d05…c4f8", flush: 9, buy: 1, burn: 4, reward: 0.0192 },
    ],
  };
}

// ------------------------------------------------------------------ rules, as in the contracts

export const isLaunch = (s: SimState) => s.preset === "launch";

/// The launch schedule: 99% at the open, one point lower each minute, down to the standing tax.
export const launchTaxAt = (minute: number) => Math.max(LAUNCH_TAX - 0.01 * minute, STANDING_TAX);

export function buyTax(s: SimState): number {
  return isLaunch(s) ? launchTaxAt(s.launchMinute) : STANDING_TAX;
}

export function avgCost(s: SimState): number {
  if (!s.seats.length) return 0;
  return s.seats.reduce((a, x) => a + x.cost, 0) / s.seats.length;
}

export interface ModeInfo {
  name: "Spinning" | "Shedding";
  seatBps: number;
  why: string;
}

export function mode(s: SimState): ModeInfo {
  if (!s.seats.length || s.floor <= avgCost(s)) {
    return {
      name: "Spinning",
      seatBps: 0.7,
      why: s.seats.length
        ? "floor is under what the vault paid, so 70% of the strategy share buys seats"
        : "no seats held yet, so 70% of the strategy share buys seats",
    };
  }
  return {
    name: "Shedding",
    seatBps: 0.3,
    why: "floor is above what the vault paid, so 70% of the strategy share burns PUPATE",
  };
}

/// Listing multiple of cost on a given day: 1.5 falling in a straight line to 1.1 at day 14.
export const listMultiple = (day: number) => 1.5 - (0.4 * Math.min(day, 14)) / 14;
export const listPrice = (x: Seat) => x.cost * listMultiple(x.day);
export const ripeness = (x: Seat) => Math.min(x.day, 14) / 14;
export const nextSeatPrice = (s: SimState) => s.floor * (1 + REWARD);

export function decay(start: number, ageH: number): number {
  if (ageH >= 48) return 0;
  const steps = Math.floor(ageH / HALF_LIFE_H);
  const into = ageH - steps * HALF_LIFE_H;
  const p = start / Math.pow(2, steps);
  return p - (p * into) / (2 * HALF_LIFE_H);
}

export const auctionPrice = (a: Auction) => decay(a.start, a.ageH);

export const canFlush = (s: SimState) => s.hookWaiting > 0;
export const canBuySeat = (s: SimState) => s.seatPot >= nextSeatPrice(s);
export const canBurn = (s: SimState) => s.burnPot > 0 && s.burnCooldown === 0;

export interface Breakdown {
  eth: number; // the ETH side of the trade
  tax: number;
  toPool: number;
  toSeats: number;
  toBurn: number;
  toDeveloper: number;
  toImd: number;
  rate: number;
}

/// Where the ETH side of a trade goes, at the tax and mode of this moment.
export function breakdown(s: SimState, amount: number): Breakdown | null {
  if (!(amount > 0)) return null;
  const rate = s.buying ? buyTax(s) : STANDING_TAX;
  const eth = s.buying ? amount : (amount / RATE) * (1 - LP_FEE);
  const tax = eth * rate;
  const strategy = tax * SHARE.strategy;
  const m = mode(s);
  return {
    eth,
    tax,
    toPool: eth - tax,
    toSeats: strategy * m.seatBps,
    toBurn: strategy * (1 - m.seatBps),
    toDeveloper: tax * SHARE.developer,
    toImd: tax * SHARE.imd,
    rate,
  };
}

// ------------------------------------------------------------------ actions

export type Action =
  | { type: "preset"; name: "steady" | "launch" }
  | { type: "advance" }
  | { type: "flush" }
  | { type: "buySeat" }
  | { type: "sellSeat"; id: number }
  | { type: "burn" }
  | { type: "burnTick" }
  | { type: "startAuction" }
  | { type: "takeAuction" }
  | { type: "wallet"; address: string | null }
  | { type: "direction"; buying: boolean }
  | { type: "swap"; amount: number }
  | { type: "dismissToast" };

let toastId = 0;
const stamp = (s: SimState) => (isLaunch(s) ? `min ${s.launchMinute}` : `day ${s.day}`);
const withToast = (s: SimState, text: string): SimState => {
  const id = ++toastId;
  return { ...s, toast: { id, text }, log: [{ id, when: stamp(s), text }, ...s.log].slice(0, 8) };
};

export const YOU = "you";
function credit(s: SimState, kind: "flush" | "buy" | "burn", reward: number): Caller[] {
  const who = s.wallet ?? YOU;
  const found = s.callers.find((c) => c.who === who);
  const row = found ?? { who, flush: 0, buy: 0, burn: 0, reward: 0 };
  const next = { ...row, [kind]: row[kind] + 1, reward: row.reward + reward };
  return found ? s.callers.map((c) => (c === found ? next : c)) : [...s.callers, next];
}

export function reduce(s: SimState, a: Action): SimState {
  switch (a.type) {
    case "preset":
      return { ...preset(a.name), wallet: s.wallet };

    case "advance": {
      if (isLaunch(s)) {
        const next = { ...s, launchMinute: Math.min(s.launchMinute + 30, LAUNCH_MINUTES) };
        return withToast(next, `Half an hour later: the buy tax is ${pct(buyTax(next))}.`);
      }
      const history = [...s.history, { day: s.day, burned: s.burned, seats: s.seats.length }];
      const seats = s.seats.map((x) => ({
        ...x,
        day: x.day + 1,
        jobs: x.status === "working" ? x.jobs + 3 + Math.floor(Math.random() * 7) : x.jobs,
      }));
      const floor = Math.round(s.floor * (0.97 + Math.random() * 0.06) * 100) / 100;
      const auction = s.auction ? { ...s.auction, ageH: s.auction.ageH + 24 } : null;
      let next: SimState = { ...s, day: s.day + 1, seats, floor, auction, burnCooldown: 0, history };
      const ripe = seats.filter((x) => x.day >= 10);
      if (ripe.length && Math.random() < 0.5) {
        const sold = ripe[0];
        const price = listPrice(sold);
        next = {
          ...next,
          seats: seats.filter((x) => x !== sold),
          burnPot: next.burnPot + price,
          sold: [{ id: sold.id, bought: sold.cost, sold: price, held: sold.day, burned: 0 }, ...next.sold],
        };
        return withToast(next, `A day passed. Seat ${pad4(sold.id)} sold for ${eth(price)}; the ETH is in the burn pot.`);
      }
      return withToast(next, `A day passed. Listings fell, the seats kept working, the floor is ${eth(floor)}.`);
    }

    case "flush": {
      if (!canFlush(s)) return s;
      const amount = s.hookWaiting;
      const m = mode(s);
      const strategy = amount * SHARE.strategy;
      const next = {
        ...s,
        dev: s.dev + amount * SHARE.developer,
        imdBurn: s.imdBurn + amount * SHARE.imd,
        seatPot: s.seatPot + strategy * m.seatBps,
        burnPot: s.burnPot + strategy * (1 - m.seatBps),
        hookWaiting: 0,
        callers: credit(s, "flush", 0),
      };
      return withToast(
        next,
        `Flushed ${eth(amount)} to the vault: ${pct(m.seatBps)} of the strategy share to the seat pot (${m.name}).`,
      );
    }

    case "buySeat": {
      if (!canBuySeat(s)) return s;
      const price = s.floor;
      const reward = price * REWARD;
      const id = 100 + Math.floor(Math.random() * 1900);
      const next = {
        ...s,
        seatPot: s.seatPot - price - reward,
        seats: [...s.seats, seat(id, price, 0, 0, "working")],
        callers: credit(s, "buy", reward),
      };
      return withToast(
        next,
        `Bought seat ${pad4(id)} for ${eth(price)} and listed it at ${eth(price * 1.5)}. Caller reward ${eth(reward, 4)}.`,
      );
    }

    case "sellSeat": {
      const x = s.seats.find((q) => q.id === a.id);
      if (!x) return s;
      const price = listPrice(x);
      const next = {
        ...s,
        seats: s.seats.filter((q) => q !== x),
        burnPot: s.burnPot + price,
        sold: [{ id: x.id, bought: x.cost, sold: price, held: x.day, burned: 0 }, ...s.sold],
      };
      return withToast(next, `Seat ${pad4(x.id)} sold for ${eth(price)}. The ETH is in the burn pot, waiting for a burn.`);
    }

    case "burn": {
      if (!canBurn(s)) return s;
      const spend = Math.min(s.burnPot * (1 - REWARD), IMPACT_CAP_ETH);
      const reward = spend * REWARD;
      const got = spend * RATE * (1 - LP_FEE);
      const limited = spend < s.burnPot * (1 - REWARD);
      // The pot is one pool of ETH; the preview credits a burn to the oldest sale still waiting.
      const waiting = [...s.sold].reverse().find((r) => r.burned === 0);
      const next = {
        ...s,
        burnPot: s.burnPot - spend - reward,
        burned: s.burned + got,
        sold: s.sold.map((r) => (r === waiting ? { ...r, burned: got } : r)),
        burnCooldown: 5,
        callers: credit(s, "burn", reward),
      };
      return withToast(
        next,
        `Burned ${int(got)} PUPATE with ${eth(spend, 3)}${limited ? " (stopped at the 5% impact limit)" : ""}. Caller reward ${eth(reward, 4)}.`,
      );
    }

    case "burnTick":
      return s.burnCooldown > 0 ? { ...s, burnCooldown: s.burnCooldown - 1 } : s;

    case "startAuction": {
      if (s.auction) return s;
      return withToast(
        { ...s, auction: { token: "SOME", lot: 1000, start: 1, ageH: 0 } },
        "Auction opened: 1,000 SOME, starting at 1 ETH and halving every 2 hours.",
      );
    }

    case "takeAuction": {
      if (!s.auction) return s;
      const price = auctionPrice(s.auction);
      const next = { ...s, seatPot: s.seatPot + price, harvested: s.harvested + price, auction: null };
      return withToast(
        next,
        `Took ${int(s.auction.lot)} ${s.auction.token} for ${eth(price, 4)}. The ETH went to the seat pot.`,
      );
    }

    case "wallet": {
      const short = a.address ? `${a.address.slice(0, 6)}…${a.address.slice(-4)}` : null;
      if (short === s.wallet) return s;
      if (!short) return { ...s, wallet: null };
      return withToast({ ...s, wallet: short }, `Wallet ${short} connected. Trades stay simulated until the contracts are live.`);
    }

    case "direction":
      return { ...s, buying: a.buying };

    case "swap": {
      const b = breakdown(s, a.amount);
      if (!s.wallet || !b) return s;
      const next = { ...s, taxCollected: s.taxCollected + b.tax, hookWaiting: s.hookWaiting + b.tax };
      if (s.buying) {
        return withToast(
          next,
          `Bought ${int(b.toPool * (1 - LP_FEE) * RATE)} PUPATE for ${eth(a.amount)}. Tax ${eth(b.tax, 3)} waits in the hook.`,
        );
      }
      return withToast(next, `Sold ${int(a.amount)} PUPATE for ${eth(b.toPool, 4)}. Tax ${eth(b.tax, 4)} waits in the hook.`);
    }

    case "dismissToast":
      return { ...s, toast: null };
  }
}

export function receiveEstimate(s: SimState, amount: number): string {
  const b = breakdown(s, amount);
  if (!b) return s.buying ? "0 PUPATE" : "0 ETH";
  if (s.buying) return `${int(b.toPool * (1 - LP_FEE) * RATE)} PUPATE`;
  return `${b.toPool.toLocaleString("en-US", { maximumFractionDigits: 6 })} ETH`;
}

// ------------------------------------------------------------------ formatting

export const eth = (n: number, dp = 2) =>
  `${n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })} ETH`;
export const int = (n: number) => Math.round(n).toLocaleString("en-US");
export const pct = (n: number) => `${(n * 100).toFixed(n * 100 < 10 ? 1 : 0)}%`;
export const pad4 = (id: number) => String(id).padStart(4, "0");
export const hm = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h ? `${h}h ` : ""}${m}m`;
};
