"use client";

import { auctionPrice, eth, int, pad4 } from "@/lib/sim";
import { useDispatch, useSim } from "./SimContext";

export function Emerge() {
  const s = useSim();
  const dispatch = useDispatch();
  const total = s.sold.reduce((a, r) => a + r.burned, 0) || s.burned;
  const left = s.auction ? Math.max(0, 48 - s.auction.ageH) : 0;
  return (
    <section className="wrap section" id="emerge" aria-label="Emerge">
      <header>
        <h2>Emerge</h2>
        <p>
          When a listing fills, the ETH goes to the burn pot, which buys PUPATE from the launch pool and destroys it.
          Tokens a seat earned while it worked are auctioned, and the ETH returns to the seat pot.
        </p>
      </header>
      {s.sold.length === 0 && !s.auction ? (
        <div className="empty">Nothing has emerged yet. A seat sells when a buyer takes its listing.</div>
      ) : (
        <>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Seat</th>
                  <th className="num">Bought</th>
                  <th className="num">Sold</th>
                  <th className="num">Held</th>
                  <th className="num">PUPATE burned</th>
                </tr>
              </thead>
              <tbody>
                {s.sold.map((r) => (
                  <tr key={`${r.id}-${r.sold}`}>
                    <td>{pad4(r.id)}</td>
                    <td className="num">{eth(r.bought)}</td>
                    <td className="num">{eth(r.sold)}</td>
                    <td className="num">{r.held} days</td>
                    <td className="num">{r.burned ? int(r.burned) : "pending burn"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>Burned so far, {((s.burned / 1e9) * 100).toFixed(2)}% of supply</td>
                  <td className="num">{int(Math.max(total, s.burned))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="stats">
            <div className="stat">
              <div className="label">IMD bought and burned</div>
              <div className="v num">{int(s.imdBurned)} IMD</div>
              <div className="s">5% of tax, sold by falling auction</div>
            </div>
            <div className="stat">
              <div className="label">Seat earnings harvested</div>
              <div className="v num">{eth(s.harvested)}</div>
              <div className="s">auctioned, back to the seat pot</div>
            </div>
            <div className="stat">
              <div className="label">Developer share</div>
              <div className="v num">{eth(s.dev)}</div>
              <div className="s">10% of tax, pays oracle reports and seat machines</div>
            </div>
          </div>
          {s.auction && (
            <div className="auction">
              <div>
                <div className="label">Falling auction, live</div>
                <div className="v num">
                  {int(s.auction.lot)} {s.auction.token} <span className="dim">for</span> {eth(auctionPrice(s.auction), 4)}
                </div>
              </div>
              <button className="btn" onClick={() => dispatch({ type: "takeAuction" })}>
                Take the lot →
              </button>
              <div className="s num">
                Earned by the seats while they worked. The price halves every 2 hours and is zero after 48; {Math.floor(left)}h{" "}
                {Math.round((left % 1) * 60)}m left. The first taker gets the whole lot, and the ETH goes to the seat pot.
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
