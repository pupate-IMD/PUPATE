"use client";

import { useEffect, useState, type FormEvent } from "react";
import { avgCost, buyTax, eth, hm, isLaunch, mode, nextSeatPrice, pct, receiveEstimate } from "@/lib/sim";
import { useDispatch, useSim } from "./SimContext";

export function Feed() {
  const s = useSim();
  const dispatch = useDispatch();
  const [amount, setAmount] = useState("0.5");
  const [ago, setAgo] = useState(108 * 60);

  useEffect(() => {
    const t = setInterval(() => setAgo((a) => a + 30), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => setAmount(s.buying ? "0.5" : "10000000"), [s.buying]);

  const m = mode(s);
  const left = 6 * 3600 - ago;
  const progress = Math.min(s.seatPot / nextSeatPrice(s), 1);
  const value = parseFloat(amount.replace(",", "."));

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!s.wallet) dispatch({ type: "connect" });
    else dispatch({ type: "swap", amount: value });
  }

  return (
    <section className="wrap two" id="feed" aria-label="Feed">
      <form className="swap" onSubmit={submit}>
        <div className="head">
          <span>$PUPATE</span>
          <span className="faint">launch pool · ETH/PUPATE · hook 0x18CC</span>
        </div>
        <div className="tabs" role="group" aria-label="Direction">
          <button type="button" aria-pressed={s.buying} onClick={() => dispatch({ type: "direction", buying: true })}>
            Buy
          </button>
          <button type="button" aria-pressed={!s.buying} onClick={() => dispatch({ type: "direction", buying: false })}>
            Sell
          </button>
        </div>
        <div className="field">
          <label className="label" htmlFor="amount">
            {s.buying ? "You pay" : "You sell"}
          </label>
          <div className="row">
            <input id="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoComplete="off" />
            <span className="unit">{s.buying ? "ETH" : "PUPATE"}</span>
          </div>
        </div>
        <div className="field">
          <span className="label">You receive, after tax and the 0.3% pool fee</span>
          <div className="row">
            <span className="out num">{receiveEstimate(s, value)}</span>
          </div>
        </div>
        <div className="taxline">
          <span className="num">
            {isLaunch(s)
              ? `Buy tax now ${pct(buyTax(s))}. Reaches 6% in ${93 - s.launchMinute} minutes. Sell tax 6%.`
              : "Buy tax now 6%. Sell tax 6%."}
          </span>
          <span className="dim num">1 ETH = 70,400,000 PUPATE</span>
        </div>
        <button className="cta" type="submit">
          {s.wallet ? (s.buying ? "Buy PUPATE" : "Sell PUPATE") : "Connect wallet"}
        </button>
        <p className="note">
          {s.wallet
            ? `Simulated wallet ${s.wallet}. Trades here change the figures on this page and nothing else.`
            : "Simulated: the first click connects a pretend wallet, the next ones trade against the sample pool."}
        </p>
      </form>

      <div>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>Conditions</h2>
        <div className="kv">
          <div className="r">
            <span className="k">Reference price</span>
            <span className="v num">
              {eth(s.floor)} <span className="dim">median of 24h sales, from the IMD oracle</span>
            </span>
          </div>
          <div className="r">
            <span className="k">Report</span>
            <span className="v num">
              {left > 0 ? (
                <>
                  {hm(ago)} ago <span className="dim">· fresh for {hm(left)} more</span>
                </>
              ) : (
                <>
                  {hm(ago)} ago <span className="dim">· stale: the vault is not buying</span>
                </>
              )}
            </span>
          </div>
          <div className="r">
            <span className="k">Mode</span>
            <span className="v">
              <span className={`mode ${m.name.toLowerCase()}`}>
                <i className="dot" aria-hidden="true" />
                {m.name}
              </span>
              <div className="dim">{m.why}</div>
            </span>
          </div>
          <div className="r">
            <span className="k">Next cocoon</span>
            <span className="v num">
              {pct(progress)} <span className="dim">· {eth(s.seatPot)} of {eth(s.floor)} in the seat pot</span>
              <div className="meter" role="img" aria-label="Seat pot against the reference price">
                <i style={{ ["--w" as string]: `${(progress * 100).toFixed(1)}%` }} />
              </div>
            </span>
          </div>
          <div className="r">
            <span className="k">Waiting in the hook</span>
            <span className="v num">
              {eth(s.hookWaiting)} <span className="dim">· flush it, no reward</span>
            </span>
          </div>
          <div className="r">
            <span className="k">Burn pot</span>
            <span className="v num">
              {eth(s.burnPot)} <span className="dim">· spent on PUPATE, 5% price impact per call</span>
            </span>
          </div>
          <div className="r">
            <span className="k">Average seat cost</span>
            <span className="v num">
              {s.seats.length ? eth(avgCost(s)) : "—"} <span className="dim">· {s.seats.length} held</span>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
