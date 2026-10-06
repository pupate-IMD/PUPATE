// A chrysalis in the IMD line style: ink outline, a hatched shell that clears as `ripe` rises, and
// the adult showing through in the accent green.
export function Chrysalis({ ripe, id }: { ripe: number; id: string }) {
  const shell = Math.max(0, 1 - ripe);
  return (
    <svg viewBox="0 0 64 96" aria-hidden="true">
      <defs>
        <pattern id={`hatch-${id}`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="4" stroke="currentColor" strokeWidth="1.2" />
        </pattern>
      </defs>
      <path d="M32 2v9" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <g style={{ opacity: Math.min(1, ripe * 0.95 + 0.05) }}>
        <path d="M32 30c-9 10-13 24-8 44 4-6 7-13 8-20 1 7 4 14 8 20 5-20 1-34-8-44z" fill="var(--ok)" />
        <path d="M32 30v44" stroke="currentColor" strokeWidth="1" fill="none" />
      </g>
      <path
        d="M32 11C16 18 11 38 14 58c3 17 10 30 18 35 8-5 15-18 18-35 3-20-2-40-18-47z"
        fill={`url(#hatch-${id})`}
        style={{ fillOpacity: shell }}
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M20 29c4-2 20-2 24 0" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}
