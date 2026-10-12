// The vault's duties, decided the way the keeper decides them, on the state the components already
// have. Each rule mirrors one in keeper/lib/actions.mjs (flushDecision, burnDecision, settleDecision,
// harvestDecisions, imdAuctionDecision, reportDecision) with the defaults of keeper/lib/config.mjs,
// so what the Run page calls ready is what the keeper would send next. Pure: no reads and no
// transactions; the page sends them.

import type { Addresses } from "./addresses";
import { auctionPrice, eth, hm, int, pad4, type Action, type SimState } from "./sim";

/// The keeper's defaults: MIN_FLUSH_WEI, MIN_BURN_WEI, MIN_IMD_AUCTION_WEI, REPORT_EVERY, REPORT_LEAD.
export const MIN_FLUSH_ETH = 0.005;
export const MIN_BURN_ETH = 0.01;
export const MIN_IMD_AUCTION_ETH = 0.01;
export const REPORT_EVERY_S = 6 * 3600;
export const REPORT_LEAD_S = 30 * 60;
/// The contracts' defaults, which the preview uses; live, they come from getParams().
const PREVIEW_PARAMS = { toleranceBps: 500, callerRewardBps: 50, burnImpactBps: 500, burnSpacing: 5 };

/// ready: the keeper would send it now. waiting: a condition is not met yet. off: the call would
/// revert. manual: it needs something this page cannot supply (a listing, an attestation, a token).
export type DutyState = "ready" | "waiting" | "off" | "manual";

export interface DutyFigure {
  k: string;
  v: string;
  note?: string;
}

export interface DutyLink {
  href: string;
  label: string;
}

export interface DutyAction {
  label: string;
  action: Action;
}

export interface Duty {
  id: "flush" | "burn" | "settle" | "harvest" | "imd" | "report" | "buy";
  title: string;
  state: DutyState;
  /// The case right now, in a sentence or two.
  now: string;
  /// What the call does.
  does: string;
  /// What it pays the caller.
  pays: string;
  figures: DutyFigure[];
  /// Buttons; present only when the step would go through.
  actions: DutyAction[];
  /// The same call from a terminal, for an agent with cast.
  cmd?: string;
  links: DutyLink[];
}

const SKILL = "/skill.md";
const CAST = "--rpc-url $RPC --private-key $KEY";
const bpsPct = (bps: number) => `${bps / 100}%`;
const fine = (n: number) => eth(n, n > 0 && n < 0.01 ? 5 : 4);
const at = (sec: number) => `${new Date(sec * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const list = (ids: number[]) => ids.map(pad4).join(", ");

/// The duties in the order the keeper runs them, with the report and the seat purchase last, since
/// a visitor cannot click those. `now` is the clock in unix seconds, for the feed's freshness.
export function duties(s: SimState, a: Addresses | null = null, now = 0): Duty[] {
  const live = s.live;
  const p = live ?? PREVIEW_PARAMS;
  const reward = p.callerRewardBps / 10_000;
  const wired = !live || live.wired;
  const cocoon = a?.cocoon ?? "<cocoon>";
  const t = now || Math.floor(Date.now() / 1000);

  // flushDecision: the hook's ETH claims on the PoolManager are at least MIN_FLUSH_WEI.
  const claims = s.hookWaiting;
  const flush: Duty = {
    id: "flush",
    title: "Flush the tax",
    state: claims <= 0 ? "off" : claims < MIN_FLUSH_ETH ? "waiting" : "ready",
    now:
      claims <= 0
        ? "Nothing to flush: the hook holds no tax. The next trade puts some there."
        : claims < MIN_FLUSH_ETH
          ? `${fine(claims)} is waiting in the hook. The keeper flushes from ${eth(MIN_FLUSH_ETH, 3)}; under that the gas costs more than the pots gain. The call itself works at any amount.`
          : `${fine(claims)} is waiting in the hook. One call moves all of it into the vault.`,
    does: "Moves the tax the hook has collected into the vault, which splits it: 85% to the seat and burn pots by the mode of the moment, 10% to the developer, 5% to the IMD burn.",
    pays: "Nothing. It is the step that fills the pots the paid steps spend from.",
    figures: [
      { k: "Waiting in the hook", v: fine(claims) },
      { k: "The keeper runs it from", v: eth(MIN_FLUSH_ETH, 3) },
    ],
    actions: claims >= MIN_FLUSH_ETH ? [{ label: "Flush", action: { type: "flush" } }] : [],
    cmd: `cast send ${a?.hook ?? "<hook>"} "flush()" ${CAST}`,
    links: [
      { href: SKILL, label: "skill.md, step 1" },
      { href: "/flow/", label: "where the tax goes" },
    ],
  };

  // burnDecision: wired, a pot of at least MIN_BURN_WEI, and the block the call would land in (the
  // next one) at or past lastBurnBlock + burnSpacing. The preview counts its own cooldown.
  const pot = s.burnPot;
  const wait = live ? Math.max(0, live.lastBurnBlock + live.burnSpacing - (live.block + 1)) : s.burnCooldown;
  const rewardUpTo = pot * (1 - reward) * reward;
  const burnState: DutyState = !wired || pot <= 0 ? "off" : pot < MIN_BURN_ETH || wait > 0 ? "waiting" : "ready";
  const burn: Duty = {
    id: "burn",
    title: "Burn",
    state: burnState,
    now: !wired
      ? "The vault is not wired to the pool yet; burn() reverts with NotWired."
      : pot <= 0
        ? "The burn pot is empty. It fills from the tax by the mode, and with the proceeds when a seat sells."
        : pot < MIN_BURN_ETH
          ? `${fine(pot)} in the pot. The keeper burns from ${eth(MIN_BURN_ETH, 2)}; under that the reward is less than the gas. The call itself works at any amount.`
          : wait > 0
            ? `Too soon: ${plural(wait, "more block")}. Burns are ${p.burnSpacing} blocks apart${live ? `, and the last one was block ${live.lastBurnBlock.toLocaleString("en-US")}` : ""}.`
            : `${fine(pot)} in the pot and the spacing has passed. The call spends what the ${bpsPct(p.burnImpactBps)} price-impact limit allows and pays you ${bpsPct(p.callerRewardBps)} of it.`,
    does: `Spends the burn pot on PUPATE in the launch pool and destroys what it buys. One call may move the pool price by at most ${bpsPct(p.burnImpactBps)}, so a large pot takes several calls, ${p.burnSpacing} blocks apart.`,
    pays: `${bpsPct(p.callerRewardBps)} of the ETH the burn spends, in the same transaction.`,
    figures: [
      { k: "Burn pot", v: fine(pot) },
      { k: "Reward", v: pot > 0 ? `up to ${eth(rewardUpTo, 5)}` : "–", note: pot > 0 ? "on what the pool takes" : undefined },
      { k: "Next burn", v: wait > 0 ? `in ${plural(wait, "block")}` : "now" },
    ],
    actions: burnState === "ready" ? [{ label: "Burn", action: { type: "burn" } }] : [],
    cmd: `cast send ${cocoon} "burn()" ${CAST}`,
    links: [
      { href: SKILL, label: "skill.md, step 4" },
      { href: "/emerge/", label: "what has burned" },
    ],
  };

  // settleDecision: a held seat whose owner changed (its listing filled). The keeper also reads
  // Seaport's fill status; this page reads the owner.
  const held = s.seats;
  const due = live ? live.settleDue : [];
  const settle: Duty = {
    id: "settle",
    title: "Settle a sold seat",
    state: held.length === 0 ? "off" : due.length ? "ready" : "waiting",
    now:
      held.length === 0
        ? "No seats held, so nothing to settle."
        : due.length
          ? `${due.length === 1 ? "Seat" : "Seats"} ${list(due)} ${due.length === 1 ? "has" : "have"} left the vault: the listing filled, and settleSeat is due.`
          : `${plural(held.length, "seat")} still listed (${list(held.map((x) => x.id))}); none has sold since the books were last settled.`,
    does: "After a buyer takes one of the vault's listings, this takes the seat off the books and cancels its other order on Seaport. The sale's ETH is already in the burn pot.",
    pays: "Nothing. It keeps the books right, and the next burn can follow.",
    figures: [
      { k: "Seats held", v: String(held.length) },
      { k: "Sold, not settled", v: due.length ? list(due) : "none" },
    ],
    actions: due.map((id) => ({ label: `Settle ${pad4(id)}`, action: { type: "settleSeat", id } })),
    cmd: `cast send ${cocoon} "settleSeat(uint256)" ${due[0] ?? "<tokenId>"} ${CAST}`,
    links: [
      { href: SKILL, label: "skill.md, step 3" },
      { href: "/cocoon/", label: "the seats held" },
    ],
  };

  // harvestDecisions: a running auction can be taken; starting one needs a token address and a
  // balance, which this page does not read (the keeper's HARVEST_TOKENS list does).
  const lot = s.auction;
  const harvestDoes =
    "Tokens the seats earn while they work sit in the vault. startAuction(token) puts the whole balance of one token up at a price that halves every 2 hours and is zero after 48; takeAuction(token) buys the lot at the price of the moment, and the ETH goes to the seat pot.";
  const harvestPays = "Nothing for starting. The taker keeps the gap between the falling price and what the lot is worth, which can be nothing.";
  const harvestLinks: DutyLink[] = [
    { href: SKILL, label: "skill.md, step 5" },
    { href: "/emerge/", label: "the auctions" },
  ];
  const harvest: Duty = lot
    ? {
        id: "harvest",
        title: "Harvest auctions",
        state: "ready",
        now: `A lot is up: ${int(lot.lot)} ${lot.token} for ${eth(auctionPrice(lot), 4)} right now, falling, free in ${hm(Math.max(0, 48 - lot.ageH) * 3600)}. The first taker gets all of it, and the ETH goes to the seat pot.`,
        does: harvestDoes,
        pays: harvestPays,
        figures: [
          { k: "Lot", v: `${int(lot.lot)} ${lot.token}` },
          { k: "Price now", v: eth(auctionPrice(lot), 4) },
          { k: "Running for", v: hm(Math.max(0, lot.ageH) * 3600) },
        ],
        actions: [{ label: "Take the lot", action: { type: "takeAuction" } }],
        cmd: `cast send ${cocoon} "takeAuction(address)" ${live?.harvestToken ?? "<token>"} --value <auctionPrice> ${CAST}`,
        links: harvestLinks,
      }
    : {
        id: "harvest",
        title: "Harvest auctions",
        state: live ? "manual" : "ready",
        now: live
          ? "No harvest auction is running. Starting one takes the address of a token the seats earned; this page does not read the vault's token balances, so it cannot say whether a lot is waiting."
          : "No auction is running. In the preview, starting one opens a sample lot.",
        does: harvestDoes,
        pays: harvestPays,
        figures: [
          { k: "Running auction", v: "none" },
          { k: "Harvested so far", v: eth(s.harvested, 4), note: "back to the seat pot" },
        ],
        actions: live ? [] : [{ label: "Start an auction", action: { type: "startAuction" } }],
        cmd: `cast send ${cocoon} "startAuction(address)" <token> ${CAST}`,
        links: harvestLinks,
      };

  // imdAuctionDecision: wired, no IMD auction running, an IMD-burn balance of at least
  // MIN_IMD_AUCTION_WEI. A running auction is there to be taken.
  const imdRunning = live?.imdAuction ?? null;
  const imdBalance = s.imdBurn;
  const imdDoes =
    "5% of the tax is set aside to buy IMD and destroy it. startImdAuction() offers that ETH; the IMD asked for it starts at 20,000 per ETH (a parameter) and falls on the same curve as the harvest auctions. takeImdAuction() pulls the IMD from the taker, sends it to the dead address and pays the taker the ETH lot.";
  const imdPays = "Nothing for starting. The taker is paid the ETH lot for the IMD they deliver; the gain is the gap between the two.";
  const imdLinks: DutyLink[] = [{ href: SKILL, label: "skill.md, step 6" }];
  let imd: Duty;
  if (imdRunning) {
    imd = {
      id: "imd",
      title: "The IMD auction",
      state: "ready",
      now: `Running: ${eth(imdRunning.lotEth, 4)} for ${int(imdRunning.demandImd)} IMD right now, and the IMD asked keeps falling. The taker delivers the IMD, which goes to the dead address, and is paid the ETH lot. The button approves the IMD first.`,
      does: imdDoes,
      pays: imdPays,
      figures: [
        { k: "ETH lot", v: eth(imdRunning.lotEth, 4) },
        { k: "IMD asked now", v: `${int(imdRunning.demandImd)} IMD` },
        { k: "Running for", v: hm(Math.max(0, t - imdRunning.startedAt)) },
      ],
      actions: [{ label: "Take the IMD auction", action: { type: "takeImdAuction" } }],
      cmd: `cast send ${a?.imd ?? "<imd>"} "approve(address,uint256)" ${cocoon} <imdDemand> ${CAST} && cast send ${cocoon} "takeImdAuction()" ${CAST}`,
      links: imdLinks,
    };
  } else {
    const state: DutyState = !wired || imdBalance <= 0 ? "off" : imdBalance < MIN_IMD_AUCTION_ETH ? "waiting" : live ? "ready" : "manual";
    imd = {
      id: "imd",
      title: "The IMD auction",
      state,
      now: !wired
        ? "The vault is not wired to the pool yet; the keeper starts no auction before that."
        : imdBalance <= 0
          ? "The IMD burn balance is empty. Each flush adds 5% of what it moves."
          : imdBalance < MIN_IMD_AUCTION_ETH
            ? `${fine(imdBalance)} in the IMD burn balance. The keeper starts an auction from ${eth(MIN_IMD_AUCTION_ETH, 2)}; the call itself works at any amount.`
            : live
              ? `${fine(imdBalance)} is set aside and no auction is running. Starting one offers it; the IMD asked starts high and falls until someone takes it.`
              : `${fine(imdBalance)} is set aside and no auction is running. The preview does not simulate the IMD auction.`,
      does: imdDoes,
      pays: imdPays,
      figures: [
        { k: "IMD burn balance", v: fine(imdBalance) },
        { k: "Running auction", v: "none" },
        { k: "IMD burned so far", v: `${int(s.imdBurned)} IMD` },
      ],
      actions: state === "ready" ? [{ label: "Start the IMD auction", action: { type: "startAuction" } }] : [],
      cmd: `cast send ${cocoon} "startImdAuction()" ${CAST}`,
      links: imdLinks,
    };
  }

  // reportDecision: due when no report is stored, when it is stale, within REPORT_LEAD of going
  // stale, or REPORT_EVERY after it was issued. Not a button: an attestation costs 0.5 IMD.
  let report: Duty;
  const reportDoes =
    "Stores a new reference price in FloorFeed from an attestation signed by IMD's oracle: a panel of twenty seats reads the collection's lowest listing and eleven must agree. The vault buys seats only while the report is fresh, six hours at most.";
  const reportPays =
    "Nothing, and the attestation costs 0.5 IMD to request from IMD's oracle. The developer's keeper pays for one every six hours; submit your own only if that has stopped and you want the vault to keep buying.";
  const reportLinks: DutyLink[] = [
    { href: SKILL, label: "skill.md, section 7" },
    { href: "/feed/", label: "verify an attestation" },
    { href: "/docs/oracle/", label: "the reference price" },
  ];
  if (!live) {
    report = {
      id: "report",
      title: "Report the reference price",
      state: "waiting",
      now: "Fresh in the preview: the sample report does not age. Live, this row says when the report goes stale and whether one is due.",
      does: reportDoes,
      pays: reportPays,
      figures: [
        { k: "Reference price", v: eth(s.floor) },
        { k: "Report", v: "fresh (sample)" },
      ],
      actions: [],
      links: reportLinks,
    };
  } else {
    const issued = live.floorIssuedAt;
    const until = live.freshUntil;
    const left = until - t;
    let state: DutyState = "manual";
    let now: string;
    if (issued === 0) now = "No report stored yet, so the vault is not buying. A report is due.";
    else if (!live.fresh) now = `Stale since ${at(until)} (${hm(Math.max(0, t - until))} ago); the vault is not buying until a report lands.`;
    else if (left <= REPORT_LEAD_S) now = `Fresh for ${hm(Math.max(0, left))}. The keeper reports within half an hour of going stale; if nothing lands, the vault stops buying at ${at(until)}.`;
    else if (t - issued >= REPORT_EVERY_S) now = `Issued ${hm(t - issued)} ago and fresh for ${hm(left)}. The keeper's six-hourly report is due.`;
    else {
      state = "waiting";
      now = `Fresh for ${hm(left)}, issued ${at(issued)}. Nothing to do until it nears ${at(until)}.`;
    }
    report = {
      id: "report",
      title: "Report the reference price",
      state,
      now,
      does: reportDoes,
      pays: reportPays,
      figures: [
        { k: "Reference price", v: s.floor > 0 ? eth(s.floor) : "none yet" },
        { k: "Report", v: live.fresh ? `fresh for ${hm(Math.max(0, left))}` : issued ? "stale" : "none" },
        { k: "Stale at", v: until ? at(until) : "–" },
      ],
      actions: [],
      links: reportLinks,
    };
  }

  // scanListings' gates: a fresh floor, a listing at or under floor plus tolerance and at least half
  // the floor, and a seat pot that covers price plus reward. The listing itself is the caller's to find.
  const floor = s.floor;
  const fresh = live ? live.fresh : true;
  const tolerance = p.toleranceBps / 10_000;
  const ceiling = floor * (1 + tolerance);
  const least = floor / 2;
  const affordable = s.seatPot / (1 + reward);
  const buy: Duty = {
    id: "buy",
    title: "Buy a seat",
    state: !fresh || floor <= 0 ? "off" : affordable < least ? "waiting" : "manual",
    now:
      !fresh || floor <= 0
        ? "No fresh reference price: buySeat reverts with FloorNotFresh, and the vault does not buy until a report lands."
        : affordable < least
          ? `The seat pot covers a seat up to ${eth(affordable)}, under half the reference price (${eth(least)}), the least a purchase may cost. It fills with 70% of the strategy share while the vault is accumulating.`
          : `The pot covers a seat up to ${eth(affordable)}. Find a listing at or under ${eth(ceiling)} on OpenSea or in Seaport's OrderValidated events and submit it; the keeper's candidates are in listings.json.`,
    does: `Fulfils a Seaport listing of one Identity MD seat for ETH from the seat pot, then lists the seat for sale from the vault. You supply the order; the vault pays. It goes through when the reference price is fresh, the order asks at most ${bpsPct(p.toleranceBps)} over it, what is paid is at least half of it, the seat pot covers price plus reward, and the order is one seat of the collection, in full, for native ETH, with nothing of it paid to the vault and not a seat the vault already holds.`,
    pays: `${bpsPct(p.callerRewardBps)} of the ETH the purchase spends, in the same transaction.`,
    figures: [
      { k: "Reference price", v: floor > 0 ? eth(floor) : "none yet", note: live ? (live.fresh ? "fresh" : "stale") : "sample" },
      { k: "Ceiling", v: floor > 0 ? eth(ceiling) : "–", note: `${bpsPct(p.toleranceBps)} over the reference` },
      { k: "The pot covers", v: eth(affordable), note: "price plus reward" },
    ],
    actions: [],
    links: [
      { href: SKILL, label: "skill.md, section 2" },
      { href: "/listings.json", label: "listings.json" },
      { href: "/cocoon/", label: "the seats held" },
    ],
  };

  return [flush, burn, settle, harvest, imd, report, buy];
}

export const readyCount = (d: Duty[]) => d.filter((x) => x.state === "ready").length;
