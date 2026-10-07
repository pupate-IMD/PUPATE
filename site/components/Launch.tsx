"use client";

import { buyTax, eth, isLaunch, LAUNCH_MINUTES, launchTaxAt, nextSeatPrice, pct } from "@/lib/sim";
import { Flash } from "./Flash";
import { LineChart } from "./LineChart";
import { useSim } from "./SimContext";

const CURVE = Array.from({ length: 121 }, (_, m) => ({ x: m, y: launchTaxAt(m) * 100 }));

/// The opening window gets the front of the page: the buy tax now, when it reaches the standing
/// rate, and the seat pot the early buyers are filling.
export function Launch() {
  const s = useSim();
  if (!isLaunch(s)) return null;
  const left = LAUNCH_MINUTES - s.launchMinute;
  const progress = Math.min(s.seatPot / nextSeatPrice(s), 1);
  return (
    <section className="wrap launch" aria-label="Launch window">
      <div className="panel launch-panel">
        <div>
          <div className="label gold">Launch window · minute {s.launchMinute}</div>
          <div className="launch-fig num">
            <Flash>{pct(buyTax(s))}</Flash>
          </div>
          <div className="label">buy tax right now</div>
          <p className="dim" style={{ marginTop: 14, maxWidth: "44ch" }}>
            {left > 0
              ? `It falls one point a minute and reaches 6% in ${left} minutes. Sells already pay 6%. Whoever buys early pays for the first seat.`
              : "The launch window is over. Buys and sells both pay 6% from here on."}
          </p>
          <div className="lead" style={{ marginTop: 14 }}>
            <span className="k">First seat</span>
            <span className="dots" aria-hidden="true" />
            <span className="v num">
              <Flash>{pct(progress)}</Flash>
              <span className="dim"> · {eth(s.seatPot)} in the seat pot</span>
            </span>
          </div>
          <div className="meter" role="img" aria-label="Seat pot against the price of the first seat">
            <i style={{ ["--w" as string]: `${(progress * 100).toFixed(1)}%` }} />
          </div>
        </div>
        <LineChart
          title="Buy tax over the launch window"
          points={CURVE}
          xLabel="Minutes since the pool opened"
          yLabel="Buy tax"
          fmtX={(x) => `${Math.round(x)} min`}
          fmtY={(y) => `${Math.round(y)}%`}
          mark={s.launchMinute}
          yMin={0}
          yMax={100}
        />
      </div>
    </section>
  );
}
