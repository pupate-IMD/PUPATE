"use client";

import { avgCost, eth, listPrice, pad4, ripeness } from "@/lib/sim";
import { Chrysalis } from "./Chrysalis";
import { useSim } from "./SimContext";

export function Cocoon() {
  const s = useSim();
  const total = s.seats.reduce((a, x) => a + x.cost, 0);
  return (
    <section className="wrap section" id="cocoon" aria-label="Cocoon">
      <header>
        <h2>Cocoon</h2>
        <p>
          Each seat the vault buys is listed at 1.5× its cost, falling to 1.1× over 14 days, and works in the IMD swarm
          for as long as it is held. A chrysalis clears as its price falls.
        </p>
      </header>
      {s.seats.length === 0 ? (
        <div className="empty">
          No seats yet. The first cocoon arrives when the seat pot reaches the reference price; at the current pace that
          is within the hour.
        </div>
      ) : (
        <>
          <p className="lede num">
            {s.seats.length} {s.seats.length === 1 ? "seat" : "seats"} held, bought for {eth(total)} in all, {eth(avgCost(s))} each on
            average.
          </p>
          <div className="cards">
            {s.seats.map((x) => {
              const r = ripeness(x);
              const atFloor = x.day >= 14;
              return (
                <article className="card" key={x.id} style={{ ["--ripe" as string]: r.toFixed(2) }}>
                  <div className="top">
                    <span className="id">Seat {pad4(x.id)}</span>
                    <span className={`chip ${atFloor ? "warn" : x.status === "working" ? "ok" : ""}`}>
                      {atFloor ? "at 1.1×" : x.status === "working" ? "working" : "idle"}
                    </span>
                  </div>
                  <div className="pin">
                    <Chrysalis ripe={r} id={String(x.id)} />
                  </div>
                  <div className="track" aria-hidden="true">
                    <i />
                  </div>
                  <dl>
                    <dt>bought</dt>
                    <dd className="num">{eth(x.cost)}</dd>
                    <dt>listed</dt>
                    <dd className="num">{eth(listPrice(x))}</dd>
                    <dt>day</dt>
                    <dd className="num">{Math.min(x.day, 14)} of 14</dd>
                    <dt>jobs accepted</dt>
                    <dd className="num">{x.jobs}</dd>
                  </dl>
                </article>
              );
            })}
          </div>
          <p className="dim" style={{ marginTop: 12, fontSize: 11 }}>
            Jobs accepted come from IMD&apos;s public seat records. A seat with no paired device earns nothing; the operator
            pairs one.
          </p>
        </>
      )}
    </section>
  );
}
