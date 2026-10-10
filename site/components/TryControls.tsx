"use client";

import { isLaunch } from "@/lib/sim";
import { useDispatch, useSim } from "./SimContext";

/// Before launch, the simulation's controls: which moment it is, and a step forward. They used to
/// sit at the top of every page; here they stay with the technical layer, where they belong.
export function TryControls() {
  const s = useSim();
  const dispatch = useDispatch();
  if (s.live) return null;
  return (
    <section className="wrap section" id="try" aria-label="Try the mechanism">
      <header>
        <span className="n">§</span>
        <h2>Try the mechanism</h2>
        <p>
          Nothing is deployed and nothing is sent: every figure under the hood is a sample, and every button runs the
          contracts&apos; rules inside this page. Pick a moment, then run the steps on any page.
        </p>
      </header>
      <div className="try-chips" role="group" aria-label="Preview state">
        <button className={`chip ${s.preset === "steady" ? "on" : ""}`} onClick={() => dispatch({ type: "preset", name: "steady" })}>
          Day 23
        </button>
        <button className={`chip ${s.preset === "launch" ? "on" : ""}`} onClick={() => dispatch({ type: "preset", name: "launch" })}>
          Launch, minute 12
        </button>
        <button className="chip" onClick={() => dispatch({ type: "advance" })}>
          {isLaunch(s) ? "Advance 30 minutes" : "Advance a day"}
        </button>
      </div>
      <details className="try-list">
        <summary>What you can try</summary>
        <ol>
          <li>
            <b>Buy</b> or <b>Sell</b> on the Feed page: simulated, the tax lands in the hook.
          </li>
          <li>
            <b>Flush the tax</b> on the Steps page: moves it into the vault, split by the mode on the vault sheet above.
          </li>
          <li>
            <b>Buy a seat</b>: enabled once the seat pot covers the reference price plus the reward; a new chrysalis appears at day 0.
          </li>
          <li>
            <b>Burn</b>: spends the burn pot up to the price-impact limit, then waits five blocks.
          </li>
          <li>
            <b>Take the lot</b> and <b>Start an auction</b> on the Emerge page: one harvest auction cycle.
          </li>
          <li>
            <b>Advance a day</b>: listings fall, chrysalises clear, the auction decays, and seats sell now and then.
          </li>
          <li>
            <b>Launch, minute 12</b>: the opening window with its buy tax falling from 99%.
          </li>
          <li>
            <b>Open the sheet</b> on any chrysalis: its listing curve, its work in the swarm, its card and a buy button.
          </li>
          <li>
            <b>Verify in this browser</b> on the Feed page: checks a real IMD oracle signature, then fails when the answer is changed.
          </li>
          <li>
            <b>Open skill.md</b> on the Steps page: the file an agent reads to run the steps.
          </li>
        </ol>
      </details>
    </section>
  );
}
