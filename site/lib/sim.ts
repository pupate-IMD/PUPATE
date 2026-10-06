// The simulated protocol behind the preview. The same rules as Cocoon and PupateHook, run against
// sample figures inside the page, so the flows can be judged before anything is deployed. Nothing
// here sends a transaction. The live site replaces this module with contract reads and writes.

export const RATE = 70_400_000; // PUPATE per ETH at the pool price (sample)
export const LP_FEE = 0.003;
export const STANDING_TAX = 0.06;
export const REWARD = 0.005;
export const IMPACT_CAP_ETH = 0.3; // what the 5% price-impact limit lets one burn spend at this depth
export const HALF_LIFE_H = 2;

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
}

const seat = (id: number, cost: number, day: number, jobs: number, status: SeatStatus): Seat => ({
  id,
  cost,
  day,
  jobs,
  status,
});

export function preset(name: "steady" | "launch"): SimState {
  const base = { wallet: null, buying: true, toast: null, burnCooldown: 0 };
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
  };
}

// ------------------------------------------------------------------ rules, as in the contracts

export const isLaunch = (s: SimState) => s.preset === "launch";

export function buyTax(s: SimState): number {
  if (!isLaunch(s)) return STANDING_TAX;
  return Math.max(0.99 - 0.01 * s.launchMinute, STANDING_TAX);
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

export const listPrice = (x: Seat) => x.cost * (1.5 - (0.4 * Math.min(x.day, 14)) / 14);
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

export function canFlush(s: SimState) {
  return s.hookWaiting > 0;
}
export function canBuySeat(s: SimState) {
  return s.seatPot >= nextSeatPrice(s);
}
export function canBurn(s: SimState) {
  return s.burnPot > 0 && s.burnCooldown === 0;
}

// ------------------------------------------------------------------ actions

export type Action =
  | { type: "preset"; name: "steady" | "launch" }
  | { type: "advance" }
  | { type: "flush" }
  | { type: "buySeat" }
  | { type: "burn" }
  | { type: "burnTick" }
  | { type: "startAuction" }
  | { type: "takeAuction" }
  | { type: "connect" }
  | { type: "direction"; buying: boolean }
  | { type: "swap"; amount: number }
  | { type: "dismissToast" };

let toastId = 0;
const withToast = (s: SimState, text: string): SimState => ({ ...s, toast: { id: ++toastId, text } });

export function reduce(s: SimState, a: Action): SimState {
  switch (a.type) {
    case "preset":
      return preset(a.name);

    case "advance": {
      if (isLaunch(s)) {
        const next = { ...s, launchMinute: Math.min(s.launchMinute + 30, 93) };
        return withToast(next, `Half an hour later: the buy tax is ${pct(buyTax(next))}.`);
      }
      const seats = s.seats.map((x) => ({
        ...x,
        day: x.day + 1,
        jobs: x.status === "working" ? x.jobs + 3 + Math.floor(Math.random() * 7) : x.jobs,
      }));
      const floor = Math.round(s.floor * (0.97 + Math.random() * 0.06) * 100) / 100;
      const auction = s.auction ? { ...s.auction, ageH: s.auction.ageH + 24 } : null;
      let next: SimState = { ...s, day: s.day + 1, seats, floor, auction, burnCooldown: 0 };
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
      const strategy = amount * 0.85;
      const next = {
        ...s,
        dev: s.dev + amount * 0.1,
        imdBurn: s.imdBurn + amount * 0.05,
        seatPot: s.seatPot + strategy * m.seatBps,
        burnPot: s.burnPot + strategy * (1 - m.seatBps),
        hookWaiting: 0,
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
      const next = { ...s, seatPot: s.seatPot - price - reward, seats: [...s.seats, seat(id, price, 0, 0, "working")] };
      return withToast(
        next,
        `Bought seat ${pad4(id)} for ${eth(price)} and listed it at ${eth(price * 1.5)}. Caller reward ${eth(reward, 4)}.`,
      );
    }

    case "burn": {
      if (!canBurn(s)) return s;
      const spend = Math.min(s.burnPot * (1 - REWARD), IMPACT_CAP_ETH);
      const reward = spend * REWARD;
      const got = spend * RATE * (1 - LP_FEE);
      const limited = spend < s.burnPot * (1 - REWARD);
      const next = { ...s, burnPot: s.burnPot - spend - reward, burned: s.burned + got, burnCooldown: 5 };
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

    case "connect":
      return withToast({ ...s, wallet: "0x3f…9c2a" }, "Pretend wallet connected. Nothing can be sent from this page.");

    case "direction":
      return { ...s, buying: a.buying };

    case "swap": {
      if (!s.wallet || !(a.amount > 0)) return s;
      if (s.buying) {
        const tax = a.amount * buyTax(s);
        const next = { ...s, taxCollected: s.taxCollected + tax, hookWaiting: s.hookWaiting + tax };
        return withToast(
          next,
          `Bought ${int(a.amount * (1 - buyTax(s)) * (1 - LP_FEE) * RATE)} PUPATE for ${eth(a.amount)}. Tax ${eth(tax, 3)} waits in the hook.`,
        );
      }
      const out = (a.amount / RATE) * (1 - LP_FEE);
      const tax = out * STANDING_TAX;
      const next = { ...s, taxCollected: s.taxCollected + tax, hookWaiting: s.hookWaiting + tax };
      return withToast(
        next,
        `Sold ${int(a.amount)} PUPATE for ${eth(out * (1 - STANDING_TAX), 4)}. Tax ${eth(tax, 4)} waits in the hook.`,
      );
    }

    case "dismissToast":
      return { ...s, toast: null };
  }
}

export function receiveEstimate(s: SimState, amount: number): string {
  if (!(amount > 0)) return s.buying ? "0 PUPATE" : "0 ETH";
  if (s.buying) return `${int(amount * (1 - buyTax(s)) * (1 - LP_FEE) * RATE)} PUPATE`;
  return `${((amount / RATE) * (1 - LP_FEE) * (1 - STANDING_TAX)).toLocaleString("en-US", { maximumFractionDigits: 6 })} ETH`;
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
