"use client";

import { avgCost, eth, listPrice, pad4, ripeness } from "@/lib/sim";
import { useWorkFeed } from "@/lib/work";
import Link from "next/link";
import { Chrysalis } from "./Chrysalis";
import { Lead } from "./Hero";
import { useSim } from "./SimContext";

export function Cocoon() {
  const s = useSim();
  const { feed } = useWorkFeed();
  const total = s.seats.reduce((a, x) => a + x.cost, 0);
  return (
    <section className="wrap section" id="cocoon" aria-label="Cocoon">
      <header>
        <span className="n">II</span>
        <h2>Cocoon</h2>
        <p>
          Each seat the vault buys is listed at 1.5× its cost, falling to 1.1× over 14 days, and works in the IMD swarm for
          as long as it is held. A chrysalis clears as its price falls.
        </p>
      </header>
      {s.seats.length === 0 ? (
        <div className="empty">
          No seats yet. The first cocoon arrives when the seat pot reaches the reference price; at the current pace that is
          within the hour.
        </div>
      ) : (
        <>
          <p className="lede num">
            {s.seats.length} {s.seats.length === 1 ? "seat" : "seats"} held, bought for {eth(total)} in all, {eth(avgCost(s))} each
            on average.
          </p>
          <div className="cards">
            {s.seats.map((x) => {
              const r = ripeness(x);
              const atFloor = x.day >= 14;
              const rec = feed?.seats.find((w) => w.tokenId === x.id);
              const working = x.status === "working" || (rec?.paired && rec.online);
              const label = atFloor ? "at 1.1×" : working ? "working" : rec?.paired ? "paired" : x.status === "held" ? "held" : "idle";
              return (
                <article className="panel card" key={x.id} style={{ ["--ripe" as string]: r.toFixed(2) }}>
                  <div className="top">
                    <Link className="id" href={`/seat/?id=${x.id}`}>
                      Seat {pad4(x.id)}
                    </Link>
                    <span className={`chip ${atFloor ? "gold" : working ? "jade" : ""}`}>
                      <i className="d" aria-hidden="true" />
                      {label}
                    </span>
                  </div>
                  <div className="pin">
                    <Chrysalis ripe={r} id={String(x.id)} />
                  </div>
                  <div className="track" aria-hidden="true">
                    <i />
                  </div>
                  <div className="rows">
                    <Lead k="bought" v={eth(x.cost)} />
                    <Lead k="listed" v={eth(listPrice(x))} />
                    <Lead k="day" v={`${Math.min(x.day, 14)} of 14`} />
                    <Lead k="jobs accepted" v={String(rec ? rec.counts.accepted : x.jobs)} />
                  </div>
                  <Link className="more label" href={`/seat/?id=${x.id}`}>
                    Open the sheet →
                  </Link>
                </article>
              );
            })}
          </div>
          <p className="dim" style={{ marginTop: 14, fontSize: 11, maxWidth: "72ch" }}>
            Jobs accepted come from IMD&apos;s public seat records. A seat with no paired device earns nothing; the operator
            pairs one.
          </p>
        </>
      )}
    </section>
  );
}
