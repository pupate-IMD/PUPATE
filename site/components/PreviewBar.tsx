"use client";

import { useEffect, useState } from "react";
import { TARGET_CHAIN_ID } from "@/lib/addresses";
import { hm, isLaunch } from "@/lib/sim";
import { useDispatch, useSim } from "./SimContext";

const CHAIN_NAME: Record<number, string> = { 1: "Ethereum", 11155111: "Sepolia", 31337: "local fork" };

/// The strip under the bar: in preview mode the controls of the simulation, in live mode the chain,
/// the block, the report's freshness and any transaction in flight.
export function PreviewBar() {
  const s = useSim();
  const dispatch = useDispatch();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 15_000);
    return () => clearInterval(t);
  }, []);

  if (s.live) {
    const left = s.live.freshUntil - now;
    return (
      <div className="preview live" role="status">
        <div className="wrap">
          <span className="label jade">Live · {CHAIN_NAME[TARGET_CHAIN_ID] ?? `chain ${TARGET_CHAIN_ID}`}</span>
          <span className="dim num">
            Block {s.live.block.toLocaleString("en-US")} · oracle report{" "}
            {s.live.fresh ? `fresh for ${hm(Math.max(left, 0))}` : "stale, the vault is not buying"}
            {s.live.pending ? ` · ${s.live.pending}, waiting for the block…` : ""}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="preview" role="note">
      <div className="wrap">
        <span className="label">Design preview</span>
        <span className="dim">
          Every figure is a sample and every button simulates the contracts inside this page. Nothing is deployed and
          nothing is sent.
        </span>
        <span className="chips" role="group" aria-label="Preview state">
          <button className={`chip ${s.preset === "steady" ? "on" : ""}`} onClick={() => dispatch({ type: "preset", name: "steady" })}>
            Day 23
          </button>
          <button className={`chip ${s.preset === "launch" ? "on" : ""}`} onClick={() => dispatch({ type: "preset", name: "launch" })}>
            Launch, minute 12
          </button>
          <button className="chip" onClick={() => dispatch({ type: "advance" })}>
            {isLaunch(s) ? "Advance 30 minutes" : "Advance a day"}
          </button>
        </span>
        <details>
          <summary>What you can try on this page</summary>
          <ol>
            <li>
              <b>Connect</b> a real wallet (RainbowKit), then <b>Buy</b> or <b>Sell</b> in the swap box: simulated, the tax lands in the hook.
            </li>
            <li>
              <b>Flush the tax</b>: moves it into the vault, split by the mode shown on the specimen sheet.
            </li>
            <li>
              <b>Buy a seat</b>: enabled once the seat pot covers the reference price plus the reward; a new chrysalis appears at day 0.
            </li>
            <li>
              <b>Burn</b>: spends the burn pot up to the price-impact limit, then waits five blocks.
            </li>
            <li>
              <b>Take the lot</b> and <b>Start an auction</b>: one harvest auction cycle.
            </li>
            <li>
              <b>Advance a day</b>: listings fall, chrysalises clear, the auction decays, and seats sell now and then.
            </li>
            <li>
              <b>Launch, minute 12</b>: the opening window with its buy tax falling from 99%.
            </li>
            <li>
              <b>Open the sheet</b> on any chrysalis: its own page, with the listing curve, its work in the swarm, its card
              and a buy button. Buy it and the page turns to its butterfly.
            </li>
            <li>
              <b>Verify in this browser</b> on the Feed page: checks a real IMD oracle signature, then fails when the answer is
              changed.
            </li>
            <li>
              <b>Open skill.md</b> on the Steps page: the file an agent reads to run the steps.
            </li>
          </ol>
        </details>
      </div>
    </div>
  );
}
