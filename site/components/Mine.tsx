"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { EPOCH_ONE_BITS, type Power, fmtHashes, fmtRate } from "@/lib/miner/job";
import { type Found, type GpuState, useMiner } from "@/lib/miner/useMiner";
import { GpuSelfTestDev } from "./GpuSelfTestDev";
import { Incubator } from "./Incubator";
import { useSim } from "./SimContext";

/// The epoch-one figures of the spec, shown before the contracts exist; live, every one is read from the chain.
const PRICE = "50,000";
const EPOCHS = 11;
const SUPPLY = 3333;
const PREVIEW_CARDS = [1, 12, 57, 133, 240];
const METER = 48;
/// Places in the drawer. Find n always takes place (n - 1) mod 8: a new card fills the next place, or
/// replaces the oldest card in its own place, and no other card moves. A card that moves is painted again,
/// and while the GPU mines, every paint waits behind its work.
const DRAWER = 8;

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/// Which preview card a practice hash "mints": the hash picks, as it will live. The reveal and the drawer
/// show the card's 540 px WebP (scripts/card-bitmaps.mjs renders it from the SVG): a bitmap draws at once,
/// while the SVG's blur filters would be rasterized on every find, behind the GPU's work.
function cardFor(f: Found): { id: number; src: string; title: string; gilt: boolean } {
  const id = PREVIEW_CARDS[parseInt(f.digest.slice(-2), 16) % PREVIEW_CARDS.length];
  return { id, src: `/cards/metamorph/c-${id}.webp`, title: `Metamorph.md #${id} · seat identity.md #1376${f.gilt ? " · gilt" : ""}`, gilt: f.gilt };
}

/// A row of digits that fills as the search approaches the hashes a hit takes on average.
function Meter({ hashes, expected, seed }: { hashes: number; expected: number; seed: string }) {
  const bits = seed ? parseInt(seed.slice(2, 14), 16).toString(2).padStart(METER, "0").slice(0, METER) : "0".repeat(METER);
  const filled = expected > 0 ? Math.min(METER, Math.floor((hashes / expected) * METER)) : 0;
  return (
    <div className="meter" aria-hidden="true">
      <span className="done">{bits.slice(0, filled)}</span>
      <span className="left">{bits.slice(filled)}</span>
    </div>
  );
}

/// The GPU half of the engine switch: why it is off when it is, what the self-test said when it ran. The
/// field notes carry the same reasons, since a disabled button's title is hard to reach.
function gpuSwitch(g: GpuState): { label: string; disabled: boolean; title: string } {
  if (!g.checked) return { label: "GPU", disabled: true, title: "Looking for WebGPU in this browser" };
  if (!g.available) return { label: "GPU unavailable", disabled: true, title: g.reason ?? "This browser cannot mine on its GPU." };
  if (g.failed) return { label: "GPU failed its checks", disabled: true, title: g.failed };
  if (g.selfTest?.running) return { label: "testing the GPU", disabled: true, title: "A known hash, 256 hits checked on the CPU, one second of work" };
  if (g.selfTest && !g.selfTest.ok) return { label: "GPU failed self-test", disabled: true, title: g.selfTest.detail };
  const name = g.name ?? "WebGPU";
  return { label: "GPU", disabled: false, title: g.selfTest ? `${name} · ${fmtRate(g.selfTest.rate)} in its self-test` : `${name} · a self-test runs before the first job` };
}

/// The mine, as a specimen bench: the drawing of the card being searched for, the readings beside it,
/// the controls as instruments, and underneath the field notes and the drawer of what was mined. Before
/// the contracts exist every run is a practice run: the hashing is real, the mint is a line in the notes.
export function Mine() {
  const s = useSim();
  const { openConnectModal } = useConnectModal();
  const { state: m, start, stop, setPower, setEngine, setAuto, mintPending } = useMiner();
  const wallet = s.wallet;
  const [reveal, setReveal] = useState<ReturnType<typeof cardFor> | null>(null);
  const sinceFound = useRef(0);
  const hashesNow = useRef(0);
  hashesNow.current = m.hashes;

  // A found hash shows its card in the incubator for a breath, then the search is drawn again. The
  // effect follows the newest find's number only: the hash count ticks twice a second and the Mint button
  // re-maps the list, and a re-run on either would cancel the timer and leave the card up.
  const newest = m.found[0];
  useEffect(() => {
    if (!newest) return;
    sinceFound.current = hashesNow.current;
    setReveal(cardFor(newest));
    const t = window.setTimeout(() => setReveal(null), 2800);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newest?.n]);

  const active = m.running || !!m.pending;
  const expectedHashes = 2 ** m.bits;
  const expectedSeconds = m.rate > 0 ? expectedHashes / m.rate : null;
  const rateText = fmtRate(m.rate);
  const [rateNumber, rateUnit] = m.running ? [rateText.replace(/ .*/, ""), rateText.replace(/^\S+ /, "")] : ["0", "H/s"];

  const state = m.pending
    ? "A hash is waiting. Mint it, or let auto-mint send the next one by itself."
    : m.running
      ? expectedSeconds
        ? `Mining. A hash takes about ${expectedSeconds < 90 ? `${Math.max(1, Math.round(expectedSeconds))} seconds` : `${Math.round(expectedSeconds / 60)} minutes`} on this machine at ${m.bits} bits.`
        : "Mining. Measuring this machine."
      : wallet
        ? "Not mining. Start when you are ready; a practice run costs nothing."
        : "Not mining. Connect a wallet, or practice without one.";

  function primary() {
    if (m.running) return { label: "Stop mining", onClick: stop };
    if (m.pending) return { label: "Mint it now (practice)", onClick: mintPending };
    if (!wallet) return { label: "Connect wallet", onClick: () => openConnectModal?.() };
    return { label: "Start mining (practice)", onClick: () => start({ miner: wallet as `0x${string}` }) };
  }
  const cta = primary();
  const drawer = m.found
    .slice(0, DRAWER)
    .map((f) => ({ f, c: cardFor(f), place: (f.n - 1) % DRAWER }))
    .sort((a, b) => a.place - b.place);
  const gpuOption = gpuSwitch(m.gpu);

  return (
    <section className="wrap mine-page" aria-label="Mine">
      <header className="bench-head">
        <div>
          <h1 className="serif">Mine a card of a seat that works.</h1>
          <p className="mine-lede">
            Your machine searches for a hash with enough leading zeros. Find one, pay the mint in PUPATE, and the hash picks
            which seat your card comes from. Lucky hashes come out gilt.
          </p>
          <span className="chip gold">Preview · contracts not live</span>
        </div>
        <dl className="readings" aria-label="The mine today">
          <div>
            <dt>mint price</dt>
            <dd>
              {PRICE} PUPATE <span className="dim">· epoch 1 of {EPOCHS}</span>
            </dd>
          </div>
          <div>
            <dt>difficulty</dt>
            <dd>
              ≈ {fmtHashes(expectedHashes)} hashes{" "}
              <span className="dim">· {m.engine === "gpu" ? `practice target ${m.bits} bits` : `${EPOCH_ONE_BITS} bits`}</span>
            </dd>
          </div>
          <div>
            <dt>minted</dt>
            <dd>
              0 <span className="dim">of {SUPPLY.toLocaleString("en-US")}</span>
            </dd>
          </div>
          <div>
            <dt>wallet</dt>
            <dd>{wallet ? short(wallet) : <span className="dim">not connected</span>}</dd>
          </div>
          <div>
            <dt>PUPATE</dt>
            <dd>
              <span className="dim">—</span>{" "}
              <Link className="chip jade" href="/buy/">
                Buy
              </Link>
            </dd>
          </div>
        </dl>
      </header>

      <div className={`panel bench ${m.running ? "on" : ""}`}>
        <Incubator sample={m.sample} running={m.running && !m.pending} reveal={reveal} />

        <div className="instruments">
          <p className="state">
            <span className={`status-dot ${m.running ? "on" : ""}`} aria-hidden="true" /> {state}
          </p>
          <div className="rate">
            <span className="serif num">{rateNumber}</span>
            <span className="unit">{rateUnit}</span>
            {m.running ? <span className="tried dim">{fmtHashes(m.hashes)} hashes tried</span> : null}
          </div>

          <label className="ruler">
            <span className="k">power</span>
            <input type="range" min={25} max={100} step={25} value={m.power} onChange={(e) => setPower(Number(e.target.value) as Power)} aria-valuetext={`${m.power} percent`} />
            <span className="v num">{m.power}%</span>
          </label>
          <div className="instrument">
            <span className="k">engine</span>
            <span className="v">
              <span className="pair" role="group" aria-label="Engine">
                <button type="button" className={`switch ${m.engine === "cpu" ? "on" : ""}`} aria-pressed={m.engine === "cpu"} onClick={() => void setEngine("cpu")}>
                  CPU
                </button>
                <button
                  type="button"
                  className={`switch ${m.engine === "gpu" ? "on" : ""}`}
                  aria-pressed={m.engine === "gpu"}
                  disabled={gpuOption.disabled}
                  title={gpuOption.title}
                  onClick={() => void setEngine("gpu")}
                >
                  {gpuOption.label}
                </button>
              </span>
              <span className="dim">{m.engine === "gpu" ? `GPU · ${m.gpu.name ?? "WebGPU"}` : `CPU, ${m.threads} thread${m.threads > 1 ? "s" : ""}`}</span>
            </span>
          </div>
          <div className="instrument">
            <span className="k">auto-mint</span>
            <span className="v">
              <button type="button" className={`switch ${m.auto ? "on" : ""}`} aria-pressed={m.auto} onClick={() => setAuto(!m.auto)}>
                {m.auto ? "on" : "off"}
              </button>
              <span className="dim"> {m.auto ? "a found hash is sent to your wallet to sign" : "a found hash waits for you"}</span>
            </span>
          </div>

          <div className="actions">
            <button type="button" className="btn mine-cta" onClick={cta.onClick}>
              {cta.label}
            </button>
            {!active && !wallet ? (
              <button type="button" className="mine-alt" onClick={() => start()}>
                or practice without a wallet
              </button>
            ) : null}
          </div>
          <p className="fine dim">
            Live, you approve PUPATE once and every mint opens your wallet to sign. Closing the tab stops mining.
          </p>
        </div>

        <div className="search">
          <span className="k">search</span>
          <Meter hashes={Math.max(0, m.hashes - sinceFound.current)} expected={expectedHashes} seed={m.sample ?? ""} />
          <span className="v dim">
            {m.tally.found} found{m.tally.gilt ? `, ${m.tally.gilt} gilt` : ""}
          </span>
        </div>
      </div>

      <div className="bench-foot">
        <section className="notes" aria-label="Field notes">
          <h2 className="serif">Field notes</h2>
          <ul>
            {m.log.map((l, i) => (
              <li key={`${l.at}-${i}`} className={l.tone}>
                <span className="at">{l.at}</span>
                <span>{l.text}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="drawer" aria-label="Cards mined this session">
          <h2 className="serif">This session&apos;s cards</h2>
          {drawer.length === 0 ? (
            <p className="dim">The cards you mine appear here, chrysalis first. Which seat they come from is the hash&apos;s choice.</p>
          ) : (
            <ul>
              {drawer.map(({ f, c, place }) => (
                <li key={place}>
                  <img src={c.src} alt={c.title} width={180} height={180} decoding="async" />
                  <span className={c.gilt ? "gold" : undefined}>
                    #{c.id}
                    {c.gilt ? " · gilt" : ""}
                    {!f.minted ? " · waiting" : ""}
                    {f.n === newest?.n ? " · new" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="after" aria-label="After the mint">
        <h2 className="serif">Cards never stop working.</h2>
        <div className="after-grid">
          <figure>
            <img src="/cards/metamorph/c-1.svg" alt="Metamorph.md #1, the holotype of seat 1376, in the cocoon" width={360} height={360} loading="lazy" />
            <figcaption>
              <b>Stake it.</b> 70% of every mint goes to the stakers, paid in IMD. No lock, unstake whenever you like.
            </figcaption>
          </figure>
          <figure>
            <img src="/cards/metamorph/b-12.svg" alt="Metamorph.md #12 emerged as its butterfly" width={360} height={360} loading="lazy" />
            <figcaption>
              <b>Watch it emerge.</b> When the vault sells the seat, the card turns into its butterfly by itself, and earns double while staked.
            </figcaption>
          </figure>
          <figure>
            <img src="/cards/metamorph/c-240.svg" alt="Metamorph.md #240 of seat 1376" width={360} height={360} loading="lazy" />
            <figcaption>
              <b>One in sixteen comes out gilt.</b> A hash with far more leading zeros than needed paints the card gold. The hash
              decides; nobody picks.
            </figcaption>
          </figure>
        </div>
        <p className="mine-foot dim">
          Preview: the contracts are not live. A practice run hashes for real and mints nothing. 303 cards per seat the vault holds,
          3,333 in all; the price rises each epoch of 303 mints. 30% of every mint goes to the developer. The design in full:{" "}
          <a href="https://github.com/pupate-IMD/PUPATE/blob/main/docs/superpowers/specs/2026-10-13-metamorph-md-design.md" target="_blank" rel="noreferrer">
            Metamorph MD on GitHub ↗
          </a>
        </p>
      </section>
      {process.env.NODE_ENV !== "production" ? <GpuSelfTestDev /> : null}
    </section>
  );
}
