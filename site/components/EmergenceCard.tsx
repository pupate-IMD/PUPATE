"use client";

import { useRef, useState } from "react";
import { traits, type Traits } from "@/lib/seat";
import { pad4 } from "@/lib/sim";

// The card is an image people take away, so it carries its own colours instead of the page's theme.
const PAPER = "#0b1410";
const INK = "#e9e6da";
const DIM = "#9aa89f";
const HAIR = "#223029";
const JADE = "#3ec28f";
const GOLD = "#d9a94b";
const SIZE = 1080;
const FONTS = {
  serif: "Georgia, 'Times New Roman', serif",
  mono: "Consolas, 'Courier New', monospace",
} as const;

function Butterfly({ t, uid }: { t: Traits; uid: string }) {
  const upper = `M4 -22C${4 + t.span * 0.45} ${-22 - t.rise} ${4 + t.span} ${-22 - t.rise * 0.95} ${4 + t.span} ${-22 - t.rise * 0.3}C${4 + t.span * 0.98} -4 ${4 + t.span * 0.55} 16 4 10Z`;
  const lower = `M4 10C${4 + t.reach * 0.9} 6 ${4 + t.reach * 1.1} ${10 + t.drop * 0.6} ${4 + t.reach * 0.5} ${10 + t.drop}C${4 + t.reach * 0.25} ${10 + t.drop * 0.92} 10 ${10 + t.drop * 0.5} 4 30Z`;
  const ray = (x: number, y: number, deg: number, len: number) => {
    const a = (deg * Math.PI) / 180;
    return `M${x} ${y}L${x + Math.cos(a) * len} ${y + Math.sin(a) * len}`;
  };
  const upperVeins = Array.from({ length: t.veins }, (_, i) => ray(6, -8, -62 + (70 * i) / (t.veins - 1), t.span));
  const lowerVeins = [22, 48, 74].map((deg) => ray(6, 16, deg, t.drop));
  const wing = (
    <g>
      <path d={lower} fill={`url(#wash-${uid})`} stroke={GOLD} strokeWidth={2} strokeLinejoin="round" />
      <path d={upper} fill={`url(#wash-${uid})`} stroke={GOLD} strokeWidth={2} strokeLinejoin="round" />
      <g clipPath={`url(#upper-${uid})`} stroke={t.tone} strokeWidth={1.2} fill="none">
        {upperVeins.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <g clipPath={`url(#lower-${uid})`} stroke={t.tone} strokeWidth={1.2} fill="none">
        {lowerVeins.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      {Array.from({ length: t.spots }, (_, i) => (
        <circle key={i} cx={4 + t.span * (0.8 - i * 0.07)} cy={-22 - t.rise * 0.62 + i * 17} r={5 - i * 0.6} fill={GOLD} />
      ))}
    </g>
  );
  return (
    <g>
      <defs>
        <radialGradient id={`wash-${uid}`} gradientUnits="userSpaceOnUse" cx={0} cy={0} r={t.span}>
          <stop offset="0" stopColor={t.tone} />
          <stop offset="0.5" stopColor="#cfe6d8" />
          <stop offset="1" stopColor={INK} />
        </radialGradient>
        <clipPath id={`upper-${uid}`}>
          <path d={upper} />
        </clipPath>
        <clipPath id={`lower-${uid}`}>
          <path d={lower} />
        </clipPath>
      </defs>
      {wing}
      <g transform="scale(-1 1)">{wing}</g>
      <path d="M-2 -52C-8 -76 -22 -90 -32 -93M2 -52C8 -76 22 -90 32 -93" stroke={INK} strokeWidth={1.4} fill="none" strokeLinecap="round" />
      <circle cx={-32} cy={-93} r={2.2} fill={INK} />
      <circle cx={32} cy={-93} r={2.2} fill={INK} />
      <circle cx={0} cy={-48} r={6.5} fill={INK} />
      <ellipse cx={0} cy={2} rx={5.5} ry={44} fill={INK} />
    </g>
  );
}

function Pupa({ t, uid, ripe }: { t: Traits; uid: string; ripe: number }) {
  const k = 2.2;
  return (
    <g transform={`rotate(${t.tilt}) translate(${-32 * k} ${-48 * k}) scale(${k})`}>
      <defs>
        <pattern id={`stipple-${uid}`} width="3" height="3" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="0.7" fill={INK} />
        </pattern>
      </defs>
      <path d="M32 -6v17" stroke={INK} strokeWidth={1.2} fill="none" />
      <g opacity={Math.min(1, ripe * 0.9 + 0.1)}>
        <path d="M32 30c-9 10-13 24-8 44 4-6 7-13 8-20 1 7 4 14 8 20 5-20 1-34-8-44z" fill={t.tone} />
        <path d="M32 30v44" stroke={INK} strokeWidth={0.8} fill="none" />
      </g>
      <path
        d="M32 11C16 18 11 38 14 58c3 17 10 30 18 35 8-5 15-18 18-35 3-20-2-40-18-47z"
        fill={`url(#stipple-${uid})`}
        fillOpacity={Math.max(0.12, 1 - ripe)}
        stroke={INK}
        strokeWidth={1.2}
      />
      {Array.from({ length: t.rings }, (_, j) => {
        const w = 14 - j * 3;
        return <path key={j} d={`M${32 - w} ${64 + j * 7}q${w} 4 ${w * 2} 0`} stroke={INK} strokeWidth={0.6} fill="none" opacity={0.6} />;
      })}
      {Array.from({ length: t.dots }, (_, i) => {
        const p = t.dots === 1 ? 0.5 : i / (t.dots - 1);
        return <circle key={i} cx={21 + 22 * p} cy={29 - 1.6 * Math.sin(Math.PI * p)} r={1.1} fill={GOLD} />;
      })}
    </g>
  );
}

interface Props {
  id: number;
  emerged: boolean;
  /// 0 to 1, how far the listing has fallen; only read while the seat is held.
  ripe?: number;
  headline: string;
  detail: string;
}

/// One seat's card: its own chrysalis while the vault holds it, its own butterfly once it has sold.
/// The drawing is fixed by the seat's number. It can be saved as a 1080 by 1080 image.
export function EmergenceCard({ id, emerged, ripe = 0, headline, detail }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const [failed, setFailed] = useState(false);
  const t = traits(id);
  const uid = `card-${id}`;

  function save() {
    const svg = ref.current;
    if (!svg) return;
    // A standalone image cannot load the page's fonts, so the copy names system ones.
    const copy = svg.cloneNode(true) as SVGSVGElement;
    copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    copy.setAttribute("width", String(SIZE));
    copy.setAttribute("height", String(SIZE));
    copy.querySelectorAll<SVGElement>("[data-font]").forEach((el) => {
      el.setAttribute("font-family", FONTS[el.dataset.font as keyof typeof FONTS]);
    });
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: "image/svg+xml" }));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = SIZE;
      canvas.height = SIZE;
      canvas.getContext("2d")?.drawImage(img, 0, 0, SIZE, SIZE);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (!blob) return setFailed(true);
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `pupate-seat-${pad4(id)}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }, "image/png");
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setFailed(true);
    };
    img.src = url;
  }

  return (
    <figure className="ecard">
      <svg ref={ref} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`Seat ${pad4(id)}: ${headline}. ${detail}.`}>
        <rect width={SIZE} height={SIZE} fill={PAPER} />
        <rect x={48} y={48} width={984} height={984} fill="none" stroke={HAIR} strokeWidth={2} />
        <path d="M48 78V48H78M1032 1002V1032H1002" fill="none" stroke={INK} strokeWidth={4} />
        <text x={92} y={122} data-font="mono" fontSize={24} letterSpacing={3} fill={DIM}>
          PUPATE · IDENTITY MD SEAT
        </text>
        <text x={92} y={204} data-font="serif" fontSize={76} fill={INK}>
          No. {pad4(id)}
        </text>
        <text x={988} y={122} data-font="mono" fontSize={24} letterSpacing={3} textAnchor="end" fill={emerged ? GOLD : JADE}>
          {emerged ? "EMERGED" : "IN THE COCOON"}
        </text>
        <g transform="translate(540 560) scale(2)">
          {emerged ? <Butterfly t={t} uid={uid} /> : <Pupa t={t} uid={uid} ripe={ripe} />}
        </g>
        <text x={92} y={908} data-font="serif" fontSize={64} fill={INK}>
          {headline}
        </text>
        <text x={92} y={964} data-font="mono" fontSize={24} fill={DIM}>
          {detail}
        </text>
        <text x={988} y={964} data-font="mono" fontSize={24} textAnchor="end" fill={emerged ? GOLD : JADE}>
          pupate.fun
        </text>
      </svg>
      <figcaption>
        <button className="btn" onClick={save} type="button">
          Save the card as an image
        </button>
        <span className="dim">
          {failed ? "This browser could not make the image. Take a screenshot of the card." : "1080 by 1080, drawn from the seat's number."}
        </span>
      </figcaption>
    </figure>
  );
}
