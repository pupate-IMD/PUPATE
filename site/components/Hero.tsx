"use client";

import { buyTax, canBuySeat, canFlush, eth, int, nextSeatPrice, pct } from "@/lib/sim";
import { useDispatch, useSim } from "./SimContext";

export function Hero() {
  const s = useSim();
  const dispatch = useDispatch();
  const progress = Math.min(s.seatPot / nextSeatPrice(s), 1);
  return (
    <section className="wrap hero" id="top" aria-label="Overview">
      <div className="panels">
        <div className="panel">
          <h2>Get PUPATE.</h2>
          <p>Buy it in the launch pool. Every buy and sell pays 6% of its ETH side to the vault.</p>
          <div>
            <div className="big num">
              {pct(buyTax(s))}
              <small>buy tax now</small>
            </div>
            <div className="sub num">sell tax 6% · pool fee 0.3% · {eth(s.taxCollected, 1)} collected</div>
          </div>
        </div>
        <div className="panel">
          <h2>The vault buys seats.</h2>
          <p>The tax buys Identity MD seats at or under the oracle&apos;s reference price. Nobody holds the keys.</p>
          <div>
            <div className="big num">
              {pct(progress)}
              <small>of the next seat</small>
            </div>
            <div className="sub num">
              {eth(s.seatPot)} in the seat pot · floor {eth(s.floor)}
            </div>
          </div>
        </div>
        <div className="panel">
          <h2>Seats work, then sell.</h2>
          <p>Each seat earns in the IMD swarm and is listed at a falling price. What it sells for burns PUPATE.</p>
          <div>
            <div className="big num">
              {s.seats.length}
              <small>{s.seats.length === 1 ? "seat held" : "seats held"}</small>
            </div>
            <div className="sub num">
              {int(s.burned)} PUPATE burned · {((s.burned / 1e9) * 100).toFixed(2)}% of supply
            </div>
          </div>
        </div>
      </div>
      <div className="actions">
        <a href="#feed">
          <span>Swap</span>
          <span aria-hidden="true">→</span>
        </a>
        <button onClick={() => dispatch({ type: "flush" })} disabled={!canFlush(s)}>
          <span>Flush {canFlush(s) ? eth(s.hookWaiting) : "the tax"}</span>
          <span aria-hidden="true">→</span>
        </button>
        <button onClick={() => dispatch({ type: "buySeat" })} disabled={!canBuySeat(s)}>
          <span>Buy a seat</span>
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  );
}
