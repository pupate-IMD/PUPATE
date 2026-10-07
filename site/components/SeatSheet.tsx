"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { eth, int, listMultiple, listPrice, pad4, ripeness } from "@/lib/sim";
import { Chrysalis } from "./Chrysalis";
import { Lead } from "./Hero";
import { LineChart } from "./LineChart";
import { useDispatch, useSim } from "./SimContext";

const COLLECTION = "0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D";

/// One seat's own sheet: its listing curve with today marked, what it has done in the swarm, and
/// the way to buy it.
export function SeatSheet() {
  const s = useSim();
  const dispatch = useDispatch();
  const router = useRouter();
  const id = Number(useSearchParams().get("id"));
  const x = s.seats.find((q) => q.id === id);
  const sale = s.sold.find((q) => q.id === id);

  if (!x) {
    return (
      <section className="wrap section">
        <header>
          <span className="n">II</span>
          <h2>Seat {Number.isFinite(id) && id > 0 ? pad4(id) : "?"}</h2>
        </header>
        <div className="empty">
          {sale
            ? `This seat has emerged: bought for ${eth(sale.bought)}, sold for ${eth(sale.sold)} after ${sale.held} days.`
            : "The vault does not hold this seat."}{" "}
          <Link href="/#cocoon" className="jade">
            Back to the cocoon →
          </Link>
        </div>
      </section>
    );
  }

  const day = Math.min(x.day, 14);
  const price = listPrice(x);
  const curve = Array.from({ length: 21 }, (_, d) => ({ x: d, y: x.cost * listMultiple(d) }));

  return (
    <section className="wrap section seat">
      <header>
        <span className="n">II</span>
        <h2>Seat {pad4(x.id)}</h2>
        <p>
          Bought {x.day} {x.day === 1 ? "day" : "days"} ago for {eth(x.cost)}. Listed at {eth(price)} today, {x.status === "working" ? "and working in the IMD swarm" : "with no worker paired yet"}.
        </p>
      </header>

      <div className="seat-grid">
        <aside className="panel seat-plate">
          <Chrysalis ripe={ripeness(x)} id={`sheet-${x.id}`} />
          <span className={`chip ${day >= 14 ? "gold" : x.status === "working" ? "jade" : ""}`}>
            <i className="d" aria-hidden="true" />
            {day >= 14 ? "at 1.1×" : x.status === "working" ? "working" : "idle"}
          </span>
          <div className="rows">
            <Lead k="Bought" v={eth(x.cost)} />
            <Lead k="Listed today" v={eth(price)} note={`${listMultiple(day).toFixed(2)}× cost`} />
            <Lead k="Day" v={`${day} of 14`} />
            <Lead k="Floor of the listing" v={eth(x.cost * 1.1)} note="from day 14 on" />
            <Lead k="Jobs accepted" v={int(x.jobs)} note={x.day ? `${(x.jobs / x.day).toFixed(1)} a day` : undefined} />
          </div>
          <button
            className="btn primary"
            onClick={() => {
              dispatch({ type: "sellSeat", id: x.id });
              router.push("/#emerge");
            }}
          >
            Buy this seat for {eth(price)} <span className="arrow">→</span>
          </button>
          <p className="dim" style={{ fontSize: 11 }}>
            Simulated here. On the live site this fills the vault&apos;s Seaport listing; the ETH goes to the burn pot.
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
            <Link className="btn" href="/#cocoon">
              All seats
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
