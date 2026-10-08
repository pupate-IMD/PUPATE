"use client";

import { eth, int, isLaunch, SUPPLY, YOU } from "@/lib/sim";
import { KeeperStatus } from "./KeeperStatus";
import { LineChart } from "./LineChart";
import { useSim } from "./SimContext";

/// The record: supply falling, seats held over time, and who has been running the steps.
export function Record() {
  const s = useSim();
  const history = [...s.history, { day: s.day, burned: s.burned, seats: s.seats.length }];
  const callers = [...s.callers].sort((a, b) => b.flush + b.buy + b.burn - (a.flush + a.buy + a.burn));
  const me = s.wallet ?? YOU;
  return (
    <section className="wrap section" id="record" aria-label="The record">
      <header>
        <span className="n">V</span>
        <h2>The record</h2>
        <p>What the mechanism has done so far, and who has been turning the crank.</p>
      </header>

      {s.live ? <KeeperStatus /> : null}

      {isLaunch(s) || history.length < 2 ? (
        <div className="empty">The charts start once the first day has passed.</div>
      ) : (
        <div className="charts">
          <LineChart
            title="PUPATE supply"
            points={history.map((h) => ({ x: h.day, y: (SUPPLY - h.burned) / 1e6 }))}
            xLabel="Day"
            yLabel="Supply"
            fmtX={(x) => `day ${Math.round(x)}`}
            fmtY={(y) => `${y.toFixed(1)}M`}
            mark={s.day}
          />
          <LineChart
            title="Seats held"
            points={history.map((h) => ({ x: h.day, y: h.seats }))}
            xLabel="Day"
            yLabel="Seats"
            fmtX={(x) => `day ${Math.round(x)}`}
            fmtY={(y) => `${Math.round(y)}`}
            mark={s.day}
            step
            yMin={0}
            yMax={Math.max(8, ...history.map((h) => h.seats))}
          />
        </div>
      )}

      <h3 className="serif sub-h">Who runs the steps</h3>
      <p className="lede">
        Flush, buy and burn are public. Anyone who calls them is listed here with what the vault paid them for it.
      </p>
      <div className="panel tablewrap">
        <table>
          <thead>
            <tr>
              <th>Caller</th>
              <th className="num">Flushes</th>
              <th className="num">Seats bought</th>
              <th className="num">Burns</th>
              <th className="num">Rewards</th>
            </tr>
          </thead>
          <tbody>
            {callers.map((c) => (
              <tr key={c.who}>
                <td>
                  {c.who}
                  {c.who === me ? <span className="chip jade" style={{ marginLeft: 8 }}>you</span> : null}
                </td>
                <td className="num">{int(c.flush)}</td>
                <td className="num">{int(c.buy)}</td>
                <td className="num">{int(c.burn)}</td>
                <td className="num">{eth(c.reward, 4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
