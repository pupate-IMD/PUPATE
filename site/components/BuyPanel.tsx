"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { formatEther } from "viem";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { breakdown, buyTax, eth, int, pct, sellTax } from "@/lib/sim";
import { SLIPPAGE_BPS, useDispatch, useQuote, useSim } from "./SimContext";

/// The one thing most visitors came for. Before launch it says so plainly; live, it is the swap,
/// with the tax in a sentence rather than a breakdown (the breakdown is on the Feed page).
export function BuyPanel() {
  const s = useSim();
  const dispatch = useDispatch();
  const { openConnectModal } = useConnectModal();
  const [amount, setAmount] = useState("0.1");
  useEffect(() => setAmount(s.buying ? "0.1" : "1000000"), [s.buying]);
  const live = s.live;
  const quote = useQuote(amount, s.buying);
  if (!live) return <Soon />;

  const value = parseFloat(amount.replace(",", "."));
  const b = s.buying ? breakdown(s, value) : null;
  const estimate =
    quote.out === null
      ? quote.loading
        ? "…"
        : "no quote"
      : s.buying
        ? `${int(Number(formatEther(quote.out)))} PUPATE`
        : `${Number(formatEther(quote.out)).toLocaleString("en-US", { maximumFractionDigits: 6 })} ETH`;
  const opening = buyTax(s) > sellTax(s);
  const busy = !!live.pending;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!s.wallet) openConnectModal?.();
    else if (!busy) dispatch({ type: "swap", amount: value, raw: amount });
  }

  return (
    <form className="panel swap buy" id="buy" onSubmit={submit}>
      <div className="head">
        <span className="serif">{s.buying ? "Buy PUPATE" : "Sell PUPATE"}</span>
        <span className="label">ETH / PUPATE · Ethereum</span>
      </div>
      <div className="tabs" role="group" aria-label="Direction">
        <button type="button" aria-pressed={s.buying} onClick={() => dispatch({ type: "direction", buying: true })}>
          Buy
        </button>
        <button type="button" aria-pressed={!s.buying} onClick={() => dispatch({ type: "direction", buying: false })}>
          Sell
        </button>
      </div>
      <div className="field">
        <label className="label" htmlFor="buy-amount">
          {s.buying ? "You pay" : "You sell"}
        </label>
        <div className="row">
          <input id="buy-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoComplete="off" />
          <span className="unit">{s.buying ? "ETH" : "PUPATE"}</span>
        </div>
      </div>
      <div className="field">
        <span className="label">You receive, estimated</span>
        <div className="row">
          <span className="out num">{estimate}</span>
        </div>
      </div>
      {opening ? (
        <div className="buy-warn">
          <b>Opening window.</b> The buy tax is {pct(buyTax(s))} right now and falls one point a minute until it reaches{" "}
          {pct(sellTax(s))}. Buying later in the window costs less.
        </div>
      ) : null}
      <div className="buy-fee dim num">
        Tax {pct(s.buying ? buyTax(s) : sellTax(s))} of the ETH side, into the vault · pool fee 1.25% · slippage {pct(SLIPPAGE_BPS / 10_000)}
        {b ? ` · ${eth(b.tax, b.tax < 0.01 ? 5 : 4)} to the vault on this trade` : ""}
      </div>
      <button className="go" type="submit" disabled={busy}>
        {!s.wallet ? "Connect wallet" : busy ? "Sending…" : s.buying ? "Buy PUPATE" : "Sell PUPATE"}
      </button>
      <p className="note">
        A real trade through Uniswap&apos;s router into the launch pool. Selling asks for two one-time approvals (Permit2). Where
        every part of the ETH goes is laid out on the <Link href="/feed/">Feed page</Link>.
      </p>
    </form>
  );
}

/// The panel before launch: no address, no swap, and a plain warning about anything that claims otherwise.
function Soon() {
  return (
    <div className="panel soon" id="buy">
      <div className="label gold">Launching soon</div>
      <div className="serif t">Not live yet.</div>
      <p className="dim">
        PUPATE has no contract address yet. At launch this panel becomes the swap: Ethereum, paired with ETH, through
        Uniswap. Until the address is published here and on @pupateIMD, anything that claims to be PUPATE is not.
      </p>
      <div className="cta">
        <a className="btn primary" href="https://x.com/pupateIMD" target="_blank" rel="noreferrer">
          Follow @pupateIMD
        </a>
        <Link className="btn" href="/how/">
          How it works
        </Link>
      </div>
    </div>
  );
}
