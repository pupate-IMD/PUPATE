"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { workLog } from "@/lib/seat";
import { eth, int, listMultiple, listPrice, pad4, ripeness } from "@/lib/sim";
import { Chrysalis } from "./Chrysalis";
import { EmergenceCard } from "./EmergenceCard";
import { Lead } from "./Hero";
import { LineChart } from "./LineChart";
import { useDispatch, useSim } from "./SimContext";

const COLLECTION = "0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D";
const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/// One seat's own sheet: its listing curve with today marked, what it has done in the swarm, its
/// card, and the way to buy it. A seat that has sold keeps its page and shows its butterfly.
export function SeatSheet() {
  const s = useSim();
  const dispatch = useDispatch();
  const id = Number(useSearchParams().get("id"));
  const x = s.seats.find((q) => q.id === id);
  const sale = s.sold.find((q) => q.id === id);

  if (!x && sale) {
    return (
      <section className="wrap section seat">
        <header>
          <span className="n">III</span>
          <h2>Seat {pad4(sale.id)} emerged</h2>
          <p>
            The vault bought it for {eth(sale.bought)} and sold it for {eth(sale.sold)} after {days(sale.held)}.{" "}
            {sale.burned
              ? `The sale burned ${int(sale.burned)} PUPATE.`
              : "The ETH is in the burn pot; the next burn spends it."}
          </p>
        </header>
        <div className="seat-grid emerged">
          <EmergenceCard
            id={sale.id}
            emerged
            headline={sale.burned ? `${int(sale.burned)} PUPATE burned` : `Sold for ${eth(sale.sold)}`}
            detail={`bought ${eth(sale.bought)} · sold ${eth(sale.sold)} · held ${days(sale.held)}`}
          />
          <div>
            <div className="rows">
              <Lead k="Bought" v={eth(sale.bought)} />
              <Lead k="Sold" v={eth(sale.sold)} note={`${(sale.sold / sale.bought).toFixed(2)}× cost`} />
              <Lead k="Held" v={days(sale.held)} />
              <Lead k="PUPATE burned" v={sale.burned ? int(sale.burned) : "pending burn"} />
            </div>
            <div className="seat-links">
              <a className="btn" href={`https://opensea.io/assets/ethereum/${COLLECTION}/${sale.id}`} target="_blank" rel="noreferrer">
                View on OpenSea
              </a>
              <Link className="btn" href="/emerge/">
                All sales
              </Link>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (!x) {
    return (
      <section className="wrap section">
        <header>
          <span className="n">II</span>
          <h2>Seat {Number.isFinite(id) && id > 0 ? pad4(id) : "?"}</h2>
        </header>
        <div className="empty">
          The vault does not hold this seat.{" "}
          <Link href="/cocoon/" className="jade">
            Back to the cocoon →
          </Link>
        </div>
      </section>
    );
  }

  const day = Math.min(x.day, 14);
  const price = listPrice(x);
  const curve = Array.from({ length: 21 }, (_, d) => ({ x: d, y: x.cost * listMultiple(d) }));
  const work = workLog(x.id, x.day, x.jobs);

  return (
    <section className="wrap section seat">
      <header>
        <span className="n">II</span>
        <h2>Seat {pad4(x.id)}</h2>
        <p>
          Bought {x.day} {x.day === 1 ? "day" : "days"} ago for {eth(x.cost)}. Listed at {eth(price)} today,{" "}
          {x.status === "working" ? "and working in the IMD swarm" : x.status === "held" ? "held by the vault" : "with no worker paired yet"}.
        </p>
      </header>

      <div className="seat-grid">
        <aside className="panel seat-plate">
          <Chrysalis ripe={ripeness(x)} id={`sheet-${x.id}`} />
          <span className={`chip ${day >= 14 ? "gold" : x.status === "working" ? "jade" : ""}`}>
            <i className="d" aria-hidden="true" />
            {day >= 14 ? "at 1.1×" : x.status === "working" ? "working" : x.status === "held" ? "held" : "idle"}
          </span>
          <div className="rows">
            <Lead k="Bought" v={eth(x.cost)} />
            <Lead k="Listed today" v={eth(price)} note={`${listMultiple(day).toFixed(2)}× cost`} />
            <Lead k="Day" v={`${day} of 14`} />
            <Lead k="Floor of the listing" v={eth(x.cost * 1.1)} note="from day 14 on" />
            <Lead k="Jobs accepted" v={int(x.jobs)} note={x.day ? `${(x.jobs / x.day).toFixed(1)} a day` : undefined} />
          </div>
          {s.live ? (
            <a className="btn primary" href={`https://opensea.io/assets/ethereum/${COLLECTION}/${x.id}`} target="_blank" rel="noreferrer">
              Buy on OpenSea for {eth(price)} <span className="arrow">→</span>
            </a>
          ) : (
            <button className="btn primary" onClick={() => dispatch({ type: "sellSeat", id: x.id })}>
              Buy this seat for {eth(price)} <span className="arrow">→</span>
            </button>
          )}
          <p className="dim" style={{ fontSize: 11 }}>
            {s.live
              ? "The vault's listing is a Seaport order; OpenSea shows it. The ETH goes to the burn pot."
              : "Simulated here. On the live site this fills the vault's Seaport listing; the ETH goes to the burn pot."}
          </p>
        </aside>

        <div>
          <LineChart
            title="Listing price"
            points={curve}
            xLabel="Days since the vault bought it"
            yLabel="Price"
            fmtX={(d) => `day ${Math.round(d)}`}
            fmtY={(y) => `${y.toFixed(2)} ETH`}
            mark={day}
          />
          <p className="dim" style={{ maxWidth: "64ch", marginTop: 10 }}>
            The price falls in a straight line from 1.5× to 1.1× of what the vault paid over 14 days, then holds. Both
            orders are published on Seaport by the vault itself; no key signs them.
          </p>
          <div className="seat-links">
            <a className="btn" href={`https://opensea.io/assets/ethereum/${COLLECTION}/${x.id}`} target="_blank" rel="noreferrer">
              View on OpenSea
            </a>
            <a className="btn" href="https://explorer.imd.fun/agents" target="_blank" rel="noreferrer">
              IMD agents
            </a>
            <Link className="btn" href="/cocoon/">
              All seats
            </Link>
          </div>
        </div>
      </div>

      <h3 className="serif sub-h">Work in the swarm</h3>
      {x.status === "held" ? (
        <div className="empty">
          Held by the vault. Pairing and job records come from IMD&apos;s seat API, which this page does not read yet; the
          chain alone shows only the holding.
        </div>
      ) : x.status === "idle" ? (
        <div className="empty">
          No device is paired with this seat, so it has accepted no jobs. The operator pairs one with{" "}
          <span className="num">authorizeWorker</span>; the approval ends by itself when the seat sells.
        </div>
      ) : work.jobs.length === 0 ? (
        <div className="empty">Paired and waiting. Its first job appears here.</div>
      ) : (
        <div className="seat-grid">
          <div>
            <div className="rows">
              <Lead k="Jobs accepted" v={int(x.jobs)} note={x.day ? `${(x.jobs / x.day).toFixed(1)} a day` : "today"} />
              {work.kinds.map((k) => (
                <Lead key={k.kind} k={k.kind} v={int(k.count)} />
              ))}
            </div>
            <p className="dim" style={{ fontSize: 11, marginTop: 10 }}>
              Tokens a seat earns from launches go to the vault, are sold by falling auction, and the ETH returns to the seat
              pot. This is a sample record; the live site reads IMD&apos;s public seat records.
            </p>
          </div>
          <div>
            {work.byDay.length > 1 && (
              <LineChart
                title="Jobs accepted, running total"
                points={work.byDay.map((d) => ({ x: d.day, y: d.total }))}
                xLabel="Days since the vault bought it"
                yLabel="Jobs"
                fmtX={(d) => `day ${Math.round(d)}`}
                fmtY={(y) => `${Math.round(y)}`}
                mark={x.day}
                step
                yMin={0}
                yMax={Math.ceil(x.jobs * 1.25)}
              />
            )}
            <div className="panel tablewrap" style={{ marginTop: 14 }}>
              <table>
                <thead>
                  <tr>
                    <th className="num">Job</th>
                    <th>Day</th>
                    <th>Kind</th>
                    <th>Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {work.jobs.slice(0, 8).map((j) => (
                    <tr key={j.n}>
                      <td className="num">{j.n}</td>
                      <td>day {j.day}</td>
                      <td>{j.kind}</td>
                      <td className="dim">{j.outcome}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {work.jobs.length > 8 && (
              <p className="dim" style={{ fontSize: 11, marginTop: 8 }}>
                The latest 8 of {int(work.jobs.length)}.
              </p>
            )}
          </div>
        </div>
      )}

      <h3 className="serif sub-h">Its card</h3>
      <p className="lede">
        Every seat draws its own chrysalis from its number. When the listing fills, the same number draws its butterfly.
      </p>
      <div className="ecard-row">
        <EmergenceCard
          id={x.id}
          emerged={false}
          ripe={ripeness(x)}
          headline={`Listed at ${eth(price)}`}
          detail={`bought ${eth(x.cost)} · day ${day} of 14 · ${int(x.jobs)} jobs`}
        />
      </div>
    </section>
  );
}
