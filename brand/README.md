# Brand assets

Drawn from the site's chrysalis mark, in the project palette (green-black, ivory, jade, gold).
Not AI-generated, so they match the site exactly.

| File | Size | Use |
|---|---|---|
| `logo.png` | 2048×2048 | X / profile picture. The mark alone, centred; reads when cropped to a circle. |
| `banner.png` | 3000×1000 | X header (3:1). Composition is centred, clear of the avatar's bottom-left corner. |
| `og.png` | 2400×1260 | Link preview (served from `site/public/og.png`, referenced in `site/app/layout.tsx`). |

The site favicon is `site/app/icon.svg` (same mark, Next.js serves it as the tab icon).

## Regenerate

Edit `assets.html`, then:

    node render.mjs .

It renders each `.stage` to a 2× PNG with headless Edge. Requires Microsoft Edge installed.
