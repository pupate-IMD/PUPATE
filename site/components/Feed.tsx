"use client";

import { useEffect, useState, type FormEvent } from "react";
import { avgCost, buyTax, eth, hm, isLaunch, mode, pct, receiveEstimate } from "@/lib/sim";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { Lead } from "./Hero";
import { useDispatch, useSim } from "./SimContext";

export function Feed() {
  const s = useSim();
  const dispatch = useDispatch();
  const { openConnectModal } = useConnectModal();
  const [amount, setAmount] = useState("0.5");
  const [ago, setAgo] = useState(108 * 60);

  useEffect(() => {
    const t = setInterval(() => setAgo((a) => a + 30), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => setAmount(s.buying ? "0.5" : "10000000"), [s.buying]);

  const m = mode(s);
  const left = 6 * 3600 - ago;
  const value = parseFloat(amount.replace(",", "."));

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!s.wallet) openConnectModal?.();
    else dispatch({ type: "swap", amount: value });
  }

  return (
    <section className="wrap section" id="feed" aria-label="Feed">
      <header>
        <span className="n">I</span>
        <h2>Feed</h2>
        <p>
          Every buy and sell in the launch pool pays 6% of its ETH side. Anyone can flush what has been collected into the
          vault, which splits it 85% to the strategy, 10% to the developer, 5% to buy and burn IMD.
        </p>
      </header>
      <div className="two">
        <form className="panel swap" onSubmit={submit}>
          <div className="head">
            <span className="serif">Trade in the launch pool</span>
            <span className="label">ETH / PUPATE</span>
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
          <button className="go" type="submit">
            {s.wallet ? (s.buying ? "Buy PUPATE" : "Sell PUPATE") : "Connect wallet"}
          </button>
          <p className="note">
            {s.wallet
              ? `${s.wallet} is connected. Until the contracts are live, trades here change the figures on this page and nothing else.`
              : "Connect a wallet with RainbowKit. Until the contracts are live, trades here are simulated against the sample pool."}
          </p>
        </form>

        <div className="conditions">
          <h3>Conditions</h3>
          <div className={`mode ${m.name.toLowerCase()}`} style={{ marginBottom: 6 }}>
            <i className="d" aria-hidden="true" />
            {m.name}
          </div>
          <p className="dim" style={{ marginBottom: 12, maxWidth: "52ch" }}>
            {m.why}.
          </p>
          <Lead k="Reference price" v={eth(s.floor)} note="median of 24h sales, from the IMD oracle" />
          <Lead
            k="Report"
            v={`${hm(Math.max(ago, 0))} ago`}
            note={left > 0 ? `fresh for ${hm(left)} more` : "stale: the vault is not buying"}
          />
          <Lead k="Waiting in the hook" v={eth(s.hookWaiting)} note="flush it, no reward" />
          <Lead k="Seat pot" v={eth(s.seatPot)} note={`buys the next seat at up to 105% of ${eth(s.floor)}`} />
          <Lead k="Burn pot" v={eth(s.burnPot)} note="spent on PUPATE, 5% price impact per call" />
          <Lead k="Average seat cost" v={s.seats.length ? eth(avgCost(s)) : "—"} note={`${s.seats.length} held`} />
          <Lead k="Developer share" v={eth(s.dev)} note="10% of tax, pays oracle reports and seat machines" />
        </div>
      </div>
    </section>
  );
}
