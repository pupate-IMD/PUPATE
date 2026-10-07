"use client";

import { eth, int, mode, pct, SHARE, STANDING_TAX } from "@/lib/sim";
import { Flash } from "./Flash";
import { useSim } from "./SimContext";

function Node({ k, v, s, tone }: { k: string; v: string; s?: string; tone?: "jade" | "gold" }) {
  return (
    <div className={`node ${tone ?? ""}`}>
      <div className="label">{k}</div>
      <div className="v num">
        <Flash>{v}</Flash>
      </div>
      {s ? <div className="s">{s}</div> : null}
    </div>
  );
}

const Arrow = () => (
  <span className="arrow" aria-hidden="true">
    →
  </span>
);

/// Where the money goes, with the live figure at every stop.
export function Flow() {
  const s = useSim();
  const m = mode(s);
  const volume = s.taxCollected / STANDING_TAX;
  const sales = s.sold.reduce((a, r) => a + r.sold, 0);
  return (
    <section className="wrap section" id="flow" aria-label="Where the money goes">
      <header>
        <span className="n">◦</span>
        <h2>Where the money goes</h2>
        <p>Every figure below is live. Follow one trade from the pool to the burn.</p>
      </header>

      <div className="flow">
        <div className="lane">
          <Node k="Trades" v={`≈ ${eth(volume, 0)}`} s="ETH side of every buy and sell" />
          <Arrow />
          <Node k="Tax" v={eth(s.taxCollected, 1)} s="6% of the ETH side, taken by the hook" />
          <Arrow />
          <div className="split" role="img" aria-label="The tax splits 85% strategy, 10% developer, 5% IMD burn">
            <div className="bar">
              <i className="a" style={{ flexGrow: SHARE.strategy }} />
              <i className="b" style={{ flexGrow: SHARE.developer }} />
              <i className="c" style={{ flexGrow: SHARE.imd }} />
            </div>
            <div className="keys">
              <span>
                <i className="sw a" />
                Strategy 85%
              </span>
              <span>
                <i className="sw b" />
                Developer 10%
              </span>
              <span>
                <i className="sw c" />
                IMD burn 5%
              </span>
            </div>
          </div>
        </div>

        <div className="lane">
          <span className="lane-name jade">Seats · {pct(m.seatBps)} of the strategy share</span>
          <Node tone="jade" k="Seat pot" v={eth(s.seatPot)} s="buys at or under the oracle floor" />
          <Arrow />
          <Node tone="jade" k="Seats held" v={String(s.seats.length)} s="working in the swarm, listed 1.5× → 1.1×" />
          <Arrow />
          <Node tone="jade" k="Seats sold" v={eth(sales)} s={`${s.sold.length} sold; the ETH goes to the burn pot`} />
        </div>

        <div className="lane">
          <span className="lane-name gold">Burn · {pct(1 - m.seatBps)} of the strategy share, plus every sale</span>
          <Node tone="gold" k="Burn pot" v={eth(s.burnPot)} s="buys PUPATE, 5% price impact per call" />
          <Arrow />
          <Node tone="gold" k="PUPATE burned" v={int(s.burned)} s={`${((s.burned / 1e9) * 100).toFixed(2)}% of supply, gone`} />
        </div>

        <div className="lane">
          <span className="lane-name">The rest</span>
          <Node k="Developer" v={eth(s.dev)} s="pays oracle reports and seat machines" />
          <Node k="IMD burn" v={eth(s.imdBurn)} s="auctioned for IMD, which is destroyed" />
          <Arrow />
          <Node k="IMD burned" v={`${int(s.imdBurned)} IMD`} />
        </div>
      </div>
    </section>
  );
}
