"use client";

import { useState } from "react";
import { canBurn, canBuySeat, canFlush, eth, nextSeatPrice, pct } from "@/lib/sim";
import { useDispatch, useSim } from "./SimContext";

const SKILL = "/skill.md";

function CopyLink() {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(new URL(SKILL, window.location.origin).href);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      // Clipboard refused: the link beside the button opens the same file.
    }
  }
  return (
    <button className="btn" onClick={copy} type="button">
      {done ? "Copied" : "Copy the link"}
    </button>
  );
}

export function Steps() {
  const s = useSim();
  const dispatch = useDispatch();
  const progress = Math.min(s.seatPot / nextSeatPrice(s), 1);
  const rows = [
    {
      id: "flush",
      title: "Flush the tax",
      can: canFlush(s),
      when: `Moves ${eth(s.hookWaiting)} from the hook to the vault. No reward.`,
      why: "Nothing is waiting in the hook. Trade first.",
      act: () => dispatch({ type: "flush" }),
    },
    {
      id: "buy",
      title: "Buy a seat",
      can: canBuySeat(s),
      when: `Fills the cheapest listing at or under 105% of the reference price (${eth(s.floor)} now). Reward 0.5% of what is spent.`,
      why: `Not available: the seat pot is at ${pct(progress)} of a seat.`,
      act: () => dispatch({ type: "buySeat" }),
    },
    {
      id: "burn",
      title: "Burn",
      can: canBurn(s),
      when: `Spends up to the 5% price-impact limit of the burn pot (${eth(s.burnPot)}) on PUPATE and destroys it. Reward 0.5% of the ETH spent.`,
      why: s.burnPot > 0 ? `Available in ${s.burnCooldown} blocks.` : "The burn pot is empty.",
      act: () => dispatch({ type: "burn" }),
    },
    {
      id: "auction",
      title: "Start an auction",
      can: s.auction === null,
      when: "Opens a falling-price auction for a token the seats earned. No reward; the buyer gets the discount.",
      why: "An auction is already running. Take the lot or wait for it to fall.",
      act: () => dispatch({ type: "startAuction" }),
    },
  ];
  return (
    <section className="wrap section" id="steps" aria-label="Steps anyone can run">
      <header>
        <span className="n">IV</span>
        <h2>Anyone can run a step</h2>
        <p>Nobody operates Pupate. Each step is a public function; a bot runs them, and if it stops, anyone else can.</p>
      </header>
      <div className="steps">
        {rows.map((r) => (
          <div className="step" key={r.id}>
            <div>
              <div className="t serif">{r.title}</div>
              <div className="s num">{r.can ? r.when : r.why}</div>
            </div>
            <button className="btn" onClick={r.act} disabled={!r.can}>
              Run <span className="arrow">→</span>
            </button>
          </div>
        ))}
      </div>

      <div className="panel agents" id="agents">
        <div>
          <div className="label jade">For agents</div>
          <div className="serif t">Hand your agent the keeper skill</div>
          <p className="dim">
            One file tells any agent, an IMD seat or your own, what each step is, when it can run, what it pays and how it
            fails. An agent that runs a seat purchase or a burn keeps the caller reward. No account, no allowlist.
          </p>
        </div>
        <div className="agents-actions">
          <a className="btn primary" href={SKILL} target="_blank" rel="noreferrer">
            Open skill.md <span className="arrow">→</span>
          </a>
          <CopyLink />
        </div>
      </div>
    </section>
  );
}
