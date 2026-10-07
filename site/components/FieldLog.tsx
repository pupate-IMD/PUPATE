"use client";

import { useSim } from "./SimContext";

/// Every action writes a line here, newest first, so the page keeps its own record of what happened.
export function FieldLog() {
  const s = useSim();
  return (
    <section className="wrap log" aria-label="Field log">
      <div className="head">
        <span className="label">Field log</span>
        <span className="faint" style={{ fontSize: 11 }}>
          {s.log.length ? `${s.log.length} entries this session` : "nothing yet; run a step"}
        </span>
      </div>
      <ol>
        {s.log.length === 0 ? (
          <li>
            <span className="t">—</span>
            <span className="dim">The log fills as you trade, flush, buy, burn and take lots.</span>
          </li>
        ) : (
          s.log.map((e) => (
            <li key={e.id}>
              <span className="t num">{e.when}</span>
              <span>{e.text}</span>
            </li>
          ))
        )}
      </ol>
    </section>
  );
}
