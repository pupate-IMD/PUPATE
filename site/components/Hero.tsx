"use client";

import Link from "next/link";
import { avgCost, buyTax, canBuySeat, canFlush, eth, int, mode, nextSeatPrice, pct, ripeness } from "@/lib/sim";
import { Chrysalis } from "./Chrysalis";
import { Flash } from "./Flash";
import { useDispatch, useSim } from "./SimContext";

export function Hero() {
  const s = useSim();
  const dispatch = useDispatch();
  const m = mode(s);
  const progress = Math.min(s.seatPot / nextSeatPrice(s), 1);
  const ripest = s.seats.reduce((best, x) => (ripeness(x) > ripeness(best) ? x : best), s.seats[0]);

  return (
    <div className="wrap" id="top">
      <section className="hero" aria-label="Overview">
        <div>
          <div className="eyebrow label">
            <i className={`d ${m.name.toLowerCase()}`} aria-hidden="true" />
            {s.preset === "launch" ? `Launch, minute ${s.launchMinute}` : `Day ${s.day}`} · mode {m.name.toLowerCase()} · buy tax{" "}
            {pct(buyTax(s))}
          </div>
          <h1 className="serif">
            A tax on every trade buys <em>Identity MD seats</em>. Each seat works in the swarm until it sells. What it sells
            for <em>burns PUPATE</em>.
          </h1>
          <p className="lede">
            Nobody holds the keys. The vault buys at or under the price the IMD oracle reports, lists every seat at a falling
            price, and every step can be run by anyone.
          </p>
          <div className="cta">
            <Link className="btn primary" href="/feed/">
              Trade <span className="arrow">→</span>
            </Link>
            <button className="btn" onClick={() => dispatch({ type: "flush" })} disabled={!canFlush(s)}>
              Flush {canFlush(s) ? eth(s.hookWaiting) : "the tax"}
            </button>
            <button className="btn" onClick={() => dispatch({ type: "buySeat" })} disabled={!canBuySeat(s)}>
              Buy a seat
            </button>
          </div>
        </div>

        <aside className="panel sheet" aria-label="The vault">
          <div className="title">
            <span className="serif">The vault, today</span>
            <span className="label">specimen sheet</span>
          </div>
          <div>
            <div className="fig num">
              {pct(progress)}
              <small>of the next seat</small>
            </div>
            <div className="meter" role="img" aria-label="Seat pot against the reference price" style={{ marginTop: 14 }}>
              <i style={{ ["--w" as string]: `${(progress * 100).toFixed(1)}%` }} />
            </div>
          </div>
          <div className="plate">
            {ripest ? <Chrysalis ripe={ripeness(ripest)} id="sheet" /> : <Chrysalis ripe={0} id="sheet" />}
          </div>
          <div className="rows">
            <Lead k="Reference price" v={eth(s.floor)} note="IMD oracle, 24h median" />
            <Lead k="Seat pot" v={eth(s.seatPot)} />
            <Lead k="Burn pot" v={eth(s.burnPot)} />
            <Lead k="Seats held" v={String(s.seats.length)} note={s.seats.length ? `avg cost ${eth(avgCost(s))}` : undefined} />
            <Lead k="PUPATE burned" v={int(s.burned)} note={`${((s.burned / 1e9) * 100).toFixed(2)}% of supply`} />
            <Lead k="Tax collected" v={eth(s.taxCollected, 1)} note={`${eth(s.hookWaiting)} waiting in the hook`} />
          </div>
        </aside>
      </section>

      <nav className="rail" aria-label="Stages">
        <Link href="/feed/">
          <span className="n">I</span>
          <span className="serif">Feed</span>
          <span className="s">Trading pays the tax into the vault.</span>
        </Link>
        <Link href="/cocoon/">
          <span className="n">II</span>
          <span className="serif">Cocoon</span>
          <span className="s">Seats work in the swarm while they are listed.</span>
        </Link>
        <Link href="/emerge/">
          <span className="n">III</span>
          <span className="serif">Emerge</span>
          <span className="s">Sold seats buy back and burn the token.</span>
        </Link>
      </nav>
    </div>
  );
}

export function Lead({ k, v, note }: { k: string; v: string; note?: string }) {
  return (
    <div className="lead">
      <span className="k">{k}</span>
      <span className="dots" aria-hidden="true" />
      <span className="v num">
        <Flash>{v}</Flash>
        {note ? <span className="dim"> · {note}</span> : null}
      </span>
    </div>
  );
}
