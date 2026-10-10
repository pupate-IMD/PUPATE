# The site in two layers

**Date:** 2026-10-10 · **Status:** approved in conversation, built the same day

## Why

The site was built for judges and agents: a specimen sheet of six figures on the first screen, a
navigation of nine poetic names, a preview strip with simulation controls that looked like a debug
panel, monospace small print everywhere, and raw addresses on every page. A crypto-literate visitor
arriving from X could not tell in a minute what Pupate is, whether it is safe, or what to do. The
owner's verdict: not user-friendly. The mechanism and the voice were fine; the map was not.

## Decisions

- **Two layers.** A front layer for people (home, How it works, Work) and a technical layer for agents,
  judges and auditors ("Under the hood": the existing Flow, Feed, Cocoon, Emerge, Steps, Record, Docs and
  seat pages, URLs unchanged). Nothing was removed; it was moved and framed.
- **Buy in the site, one panel.** The swap that already existed is the front page's panel, with the tax
  in a sentence instead of a breakdown. Before launch the same panel says "Not live yet", names the
  account where the address will appear, and warns that anything else is not PUPATE.
- **Plain words, Pupate's voice as flavour.** The reader knows token, swap, burn and buyback but not
  IMD. Feed, Cocoon and Emerge stay as the names of the three moves, each with a plain sentence beside
  it; IMD's terms are introduced one at a time.
- **No sample figures on the front before launch.** Numbers that look real mislead; the front shows
  figures only in live mode. The simulation and its controls live on the overview page under the hood.

## Structure

| Door | Route | What it is |
|---|---|---|
| Buy | `/#buy` | the panel on the home page |
| How it works | `/how/` | the five-minute version: the loop, what you pay, what nobody can do, who runs it, eight questions |
| Work | `/work/` | the seats' real work from IMD's records (unchanged) |
| Under the hood | `/inside/` → the technical pages | overview with the vault sheet, the page index, "Try the mechanism", the field log |

The footer on every page is one row of links (How it works, Docs, GitHub, X, Built on IMD) with the
contract addresses folded under "Contracts". The 404 page is Pupate's own.

## Components

`Home` (front page), `BuyPanel` (swap or "Not live yet"), `How`, `Inside`, `InsideBar` (the strip under
the bar on technical pages, replacing `PreviewBar`), `TryControls` (the simulation controls, moved from
the strip), `VaultSheet` (the specimen sheet, moved from the hero), `Stages` (the index, now under the
hood). `Shell` takes `layer: "front" | "inside"`. `TopBar` has four doors and exports `INSIDE`, the
technical paths. `Notes` and `PreviewBar` are gone; their content lives in `How` and `TryControls`.

## Legibility

Body text is 14px on phones (13px above), the smallest chips are 10px, and the faint tone was raised
to pass a 4.5:1 contrast check on the dark theme (and close to it on the light one).

## Not in this change

The live-mode additions (a "next seat" panel on Cocoon, a keeper heartbeat in the bar, last-run marks
on Steps, a docs page for agents) are a separate piece of work and wait for the launch.
