"use client";

import { useId, useRef, useState, type PointerEvent } from "react";

export interface Point {
  x: number;
  y: number;
}

interface Props {
  title: string;
  points: Point[];
  fmtX: (x: number) => string;
  fmtY: (y: number) => string;
  xLabel: string;
  yLabel: string;
  /// Draw the series as steps (counts) instead of straight segments.
  step?: boolean;
  /// The x of "now": a ringed marker with a direct label.
  mark?: number;
  yMin?: number;
  yMax?: number;
  yTicks?: number;
}

const W = 560;
const H = 200;
const M = { l: 68, r: 18, t: 14, b: 28 };

/// One series, one axis. A 2px line in the accent, recessive grid, the "now" point labelled
/// directly, a crosshair and tooltip on hover, and the same data as a table underneath.
export function LineChart({ title, points, fmtX, fmtY, xLabel, yLabel, step, mark, yMin, yMax, yTicks = 4 }: Props) {
  const id = useId();
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  if (points.length === 0) return null;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs) === x0 ? x0 + 1 : Math.max(...xs);
  const lo = yMin ?? Math.min(...ys);
  const hiRaw = yMax ?? Math.max(...ys);
  const hi = hiRaw === lo ? lo + 1 : hiRaw;
  const sx = (x: number) => M.l + ((x - x0) / (x1 - x0)) * (W - M.l - M.r);
  const sy = (y: number) => H - M.b - ((y - lo) / (hi - lo)) * (H - M.t - M.b);

  let d = "";
  points.forEach((p, i) => {
    if (i === 0) d += `M${sx(p.x)},${sy(p.y)}`;
    else if (step) d += `H${sx(p.x)}V${sy(p.y)}`;
    else d += `L${sx(p.x)},${sy(p.y)}`;
  });

  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => lo + ((hi - lo) * i) / yTicks);
  const xTicks = [x0, x0 + (x1 - x0) / 2, x1];

  const valueAt = (x: number): number => {
    if (step) {
      let v = points[0].y;
      for (const p of points) if (p.x <= x) v = p.y;
      return v;
    }
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      if (x <= b.x) return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x || 1);
    }
    return points[points.length - 1].y;
  };

  function onMove(e: PointerEvent<SVGSVGElement>) {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const px = ((e.clientX - box.left) / box.width) * W;
    const x = x0 + ((px - M.l) / (W - M.l - M.r)) * (x1 - x0);
    setHover(Math.min(x1, Math.max(x0, x)));
  }

  const markY = mark === undefined ? null : valueAt(mark);
  const hx = hover === null ? null : step ? Math.round(hover) : hover;
  const hy = hx === null ? null : valueAt(hx);
  const tipLeft = hx === null ? 0 : (sx(hx) / W) * 100;

  return (
    <figure className="chart">
      <figcaption className="label">{title}</figcaption>
      <div className="plot">
        <svg
          ref={ref}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-labelledby={`${id}-t`}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          <title id={`${id}-t`}>{`${title}. ${yLabel} against ${xLabel}.`}</title>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.l} x2={W - M.r} y1={sy(t)} y2={sy(t)} className="grid" />
              <text x={M.l - 8} y={sy(t) + 3.5} textAnchor="end" className="tick">
                {fmtY(t)}
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text key={t} x={sx(t)} y={H - 8} textAnchor="middle" className="tick">
              {fmtX(t)}
            </text>
          ))}
          <path d={d} className="series" />
          {mark !== undefined && markY !== null && (
            <g>
              <circle cx={sx(mark)} cy={sy(markY)} r={5} className="now" />
              <text
                x={sx(mark) + (sx(mark) > W - 130 ? -10 : 10)}
                y={sy(markY) - 10}
                textAnchor={sx(mark) > W - 130 ? "end" : "start"}
                className="direct"
              >
                {`now ${fmtY(markY)}`}
              </text>
            </g>
          )}
          {hx !== null && hy !== null && (
            <g pointerEvents="none">
              <line x1={sx(hx)} x2={sx(hx)} y1={M.t} y2={H - M.b} className="cross" />
              <circle cx={sx(hx)} cy={sy(hy)} r={4} className="probe" />
            </g>
          )}
        </svg>
        {hx !== null && hy !== null && (
          <div className="tip num" style={{ left: `${tipLeft}%` }} data-flip={tipLeft > 70 ? "1" : undefined}>
            <b>{fmtY(hy)}</b>
            <span>{fmtX(hx)}</span>
          </div>
        )}
      </div>
      <details className="chart-table">
        <summary>Table</summary>
        <table>
          <thead>
            <tr>
              <th>{xLabel}</th>
              <th className="num">{yLabel}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.x}>
                <td>{fmtX(p.x)}</td>
                <td className="num">{fmtY(p.y)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
