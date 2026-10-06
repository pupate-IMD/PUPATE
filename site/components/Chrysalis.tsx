// The chrysalis, drawn like a plate in a field guide: an ink outline, a stippled shell that clears
// as `ripe` rises, and the adult showing through in jade with gold at the wing tips.
export function Chrysalis({ ripe, id }: { ripe: number; id: string }) {
  const shell = Math.max(0, 1 - ripe);
  return (
    <svg viewBox="0 0 64 96" aria-hidden="true">
      <defs>
        <pattern id={`stipple-${id}`} width="3" height="3" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="0.75" fill="currentColor" />
        </pattern>
      </defs>
      <path d="M32 2v9" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <g style={{ opacity: Math.min(1, ripe * 0.95 + 0.05) }}>
        <path d="M32 30c-9 10-13 24-8 44 4-6 7-13 8-20 1 7 4 14 8 20 5-20 1-34-8-44z" fill="var(--jade)" />
        <path d="M24 74c2-4 5-7 8-10 3 3 6 6 8 10" stroke="var(--gold)" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <path d="M32 30v44" stroke="currentColor" strokeWidth="0.9" fill="none" />
      </g>
      <path
        d="M32 11C16 18 11 38 14 58c3 17 10 30 18 35 8-5 15-18 18-35 3-20-2-40-18-47z"
        fill={`url(#stipple-${id})`}
        style={{ fillOpacity: shell }}
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path d="M20 29c4-2 20-2 24 0" stroke="var(--gold)" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}
