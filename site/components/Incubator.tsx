"use client";

import { useEffect, useRef, useState } from "react";
import type { Hex } from "viem";

// The prototype card's contours, in its own units (the shell spans y 11..93 of a 64-wide frame).
const SHELL = "M32 11C16 18 11 38 14 58c3 17 10 30 18 35 8-5 15-18 18-35 3-20-2-40-18-47z";
const SHELL2 = "M32 13.5C18 20 13.5 38 16.3 57.5c2.8 16 9.4 28 15.7 32.6 6.3-4.6 12.9-16.6 15.7-32.6 2.8-19.5-1.7-37.5-15.7-44z";
const WING = "M32 30c-9 10-13 24-8 44 4-6 7-13 8-20 1 7 4 14 8 20 5-20 1-34-8-44z";
const WING2 = "M32 34c-6.5 8.5-9.5 20-6 36 3-5 5.2-10 6-15.6 0.8 5.6 3 10.6 6 15.6 3.5-16 0.5-27.5-6-36z";
const BAND = "M19 29c5-2.6 21-2.6 26 0";
const IDLE = "0x9b1d4e6a2f70c3851ab6e4d2c0f97e1348a5b2d6e0f1c7a93b4d5e6f70812c3d";

/// The hex digest as a run of 0s and 1s, long enough to trace a path; the string repeats if short.
function digits(hex: string, n: number, offset = 0): string {
  const h = hex.replace(/^0x/, "");
  let bits = "";
  for (const ch of h) bits += parseInt(ch, 16).toString(2).padStart(4, "0");
  if (!bits) bits = "0";
  let out = "";
  let i = offset % bits.length;
  while (out.length < n) {
    out += bits[i];
    i = (i + 1) % bits.length;
  }
  return out;
}

interface Props {
  /// The latest digest a worker hashed; null when idle.
  sample: Hex | null;
  running: boolean;
  /// A card to show in place of the drawing for a moment, after a hash was found.
  reveal: { src: string; title: string; gilt: boolean } | null;
}

/// The drawing in the console: the chrysalis of the card being searched for. While the miner runs,
/// every contour is redrawn from the digest it just hashed, so the picture is the work itself; when a
/// hash lands, the card it would mint takes its place for a breath, then the search resumes.
export function Incubator({ sample, running, reveal }: Props) {
  const [shown, setShown] = useState<Hex>(IDLE);
  const last = useRef(0);
  const reduced = useRef(false);
  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);
  useEffect(() => {
    if (!sample || !running) return;
    const now = performance.now();
    // Redraw at most ten times a second, once a second for people who asked for less motion.
    if (now - last.current < (reduced.current ? 1000 : 100)) return;
    last.current = now;
    setShown(sample);
  }, [sample, running]);

  const src = running ? shown : IDLE;
  return (
    <div className={`incubator ${running ? "on" : ""} ${reveal ? "reveal" : ""}`} aria-live="polite">
      <svg viewBox="2 0 60 100" role="img" aria-label={running ? "Mining: the chrysalis is redrawn from each hash" : "A chrysalis drawn in 0s and 1s, waiting"}>
        <defs>
          <filter id="inc-soft" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="0.5" />
          </filter>
          <path id="inc-shell" d={SHELL} />
          <path id="inc-shell2" d={SHELL2} />
          <path id="inc-wing" d={WING} />
          <path id="inc-wing2" d={WING2} />
          <path id="inc-band" d={BAND} />
          <path id="inc-vein" d="M32 30v44" />
        </defs>
        <g fontFamily="var(--mono)" letterSpacing="0.2">
          <text fontSize="2.6" fill="var(--ink)">
            <textPath href="#inc-shell">{digits(src, 120)}</textPath>
          </text>
          <text fontSize="1.7" fill="var(--ink)" opacity="0.5">
            <textPath href="#inc-shell2">{digits(src, 150, 37)}</textPath>
          </text>
          <text fontSize="2.3" fill="var(--jade)" filter="url(#inc-soft)">
            <textPath href="#inc-wing">{digits(src, 84, 91)}</textPath>
          </text>
          <text fontSize="1.6" fill="var(--jade)" opacity="0.6">
            <textPath href="#inc-wing2">{digits(src, 100, 150)}</textPath>
          </text>
          <text fontSize="1.8" fill="var(--jade)" opacity="0.85">
            <textPath href="#inc-vein">{digits(src, 28, 200)}</textPath>
          </text>
          <text fontSize="2.4" fill="var(--gold)">
            <textPath href="#inc-band">{digits(src, 18, 220)}</textPath>
          </text>
        </g>
        <path d="M24.5 73c2-3.6 4.8-6.6 7.5-9.4 2.7 2.8 5.5 5.8 7.5 9.4" stroke="var(--gold)" strokeWidth="0.9" fill="none" strokeLinecap="round" />
        <path d="M32 2v9" stroke="var(--ink)" strokeWidth="0.8" fill="none" />
      </svg>
      {reveal ? (
        <figure className={`reveal-card ${reveal.gilt ? "gilt" : ""}`}>
          <img src={reveal.src} alt={reveal.title} width={540} height={540} />
          <figcaption>{reveal.title}</figcaption>
        </figure>
      ) : null}
    </div>
  );
}
