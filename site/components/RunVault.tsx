"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { TARGET_CHAIN_ID } from "@/lib/addresses";
import { duties, readyCount, type Duty, type DutyState } from "@/lib/duties";
import { eth, int, type Action, type Run } from "@/lib/sim";
import { Lead } from "./Hero";
import { useAddresses, useDispatch, useSim } from "./SimContext";

// The page that turns a visitor into the vault's keeper. One row per duty, decided by the keeper's
// own rules on the chain's state (lib/duties.ts); a button sends the call from the visitor's wallet
// through the same actions the other pages use; under the rows, who has run what, from the events.

const CHAIN_NAME: Record<number, string> = { 1: "Ethereum", 11155111: "Sepolia", 31337: "local fork" };
const EXPLORER: Record<number, string | undefined> = { 1: "https://etherscan.io", 11155111: "https://sepolia.etherscan.io" };
const STATE_WORD: Record<DutyState, string> = { ready: "Ready", waiting: "Waiting", off: "Not now", manual: "By hand" };
const KIND: Record<Run["kind"], string> = { flush: "Flush", buy: "Bought a seat", burn: "Burn" };
const SKILL = "/skill.md";
const SLOW_AFTER_MS = 20_000;

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      // Clipboard refused: the line is selectable text right above the button.
    }
  }
  return (
    <button className="chip" type="button" onClick={copy}>
      {done ? "Copied" : "Copy"}
    </button>
  );
}

/// A link into the site goes through the router; a file (skill.md, listings.json) is a plain anchor.
function DutyLink({ href, label }: { href: string; label: string }) {
  return /\.\w+$/.test(href) ? <a href={href}>{label}</a> : <Link href={href}>{label}</Link>;
}

function DutyRow({ d, busy, go }: { d: Duty; busy: boolean; go: (a: Action) => void }) {
  return (
    <article className={`duty ${d.state}`} id={d.id} aria-label={d.title}>
      <div className="state">
        <i aria-hidden="true" />
        {STATE_WORD[d.state]}
      </div>
      <div className="body">
        <h2 className="t serif">{d.title}</h2>
        <p className="now">{d.now}</p>
        <div className="rows">
          {d.figures.map((f) => (
            <Lead key={f.k} k={f.k} v={f.v} note={f.note} />
          ))}
        </div>
        <p className="s">{d.does}</p>
        <p className="s">
          <b>Pays:</b> {d.pays}
        </p>
        <p className="s links">
          {d.links.map((l, i) => (
            <span key={l.href}>
              {i ? " · " : ""}
              <DutyLink href={l.href} label={l.label} />
            </span>
          ))}
        </p>
        {d.cmd ? (
          <details className="cmd">
            <summary>From a terminal</summary>
            <code>{d.cmd}</code>
            <Copy text={d.cmd} />
          </details>
        ) : null}
      </div>
      <div className="act">
        {d.actions.map((x) => (
          <button key={x.label} className="btn primary" type="button" disabled={busy} onClick={() => go(x.action)}>
            {busy ? "Sending…" : x.label} {busy ? null : <span className="arrow">→</span>}
          </button>
        ))}
      </div>
    </article>
  );
}

export function RunVault() {
  const s = useSim();
  const a = useAddresses();
  const dispatch = useDispatch();
  const { openConnectModal } = useConnectModal();
  // The clock, for the feed's freshness; used only once live state is in, so the prerendered page
  // and the first client render agree.
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 15_000);
    return () => clearInterval(t);
  }, []);
  const live = s.live;
  // Addresses but no chain state yet: the site is live and the first read is in flight.
  const loading = !!a && !live;
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!loading) {
      setSlow(false);
      return;
    }
    const t = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(t);
  }, [loading]);

  const rows = duties(s, a, now);
  const ready = readyCount(rows);
  const busy = !!live?.pending;
  const me = s.wallet;
  const explorer = EXPLORER[live?.chainId ?? TARGET_CHAIN_ID];
  const chain = CHAIN_NAME[live?.chainId ?? TARGET_CHAIN_ID] ?? `chain ${live?.chainId ?? TARGET_CHAIN_ID}`;
  const status = live ? `Live · ${chain} · block ${live.block.toLocaleString("en-US")}` : loading ? `Live · ${chain} · reading the chain…` : "Preview · sample figures";

  function go(action: Action) {
    if (!s.wallet) openConnectModal?.();
    else if (!busy) dispatch(action);
  }

  return (
    <section className="wrap run-page" aria-label="Run the vault">
      <header className="run-head">
        <div className={`label ${live ? "jade" : loading ? "" : "gold"}`}>{status}</div>
        <h1 className="serif">Run the vault.</h1>
        <p className="lede">
          Nobody operates Pupate. Its upkeep is a handful of public functions on the vault and the tax hook: whoever calls one
          first moves the mechanism forward, and two of them pay the caller 0.5% of the ETH they spend. Ninety minutes after
          launch a stranger called burn() before the project&apos;s own keeper did, destroyed about 7.2 million PUPATE and kept
          the reward. The rows below read the chain and say which duty is ready right now, by the same rules the keeper uses. A
          button sends the call from your own wallet; each row also carries the call for a terminal.
        </p>
        {!a ? (
          <div className="run-note">
            <b>Nothing is live here.</b> These rows run against the preview&apos;s sample figures, and a button changes only this
            page. Live, the same rows read the chain and the buttons send real calls from your wallet.
          </div>
        ) : null}
        {loading ? null : (
          <div className="run-sum" aria-label="Summary">
            <span className={`chip ${ready ? "jade" : ""}`}>
              {ready} of {rows.length} ready
            </span>
            <span className="chip">{me ? `wallet ${me}` : "no wallet connected"}</span>
            {live?.pending ? <span className="chip gold">{live.pending}, waiting for the block</span> : null}
          </div>
        )}
      </header>

      {loading ? (
        <div className="empty" style={{ marginTop: 28 }}>
          {slow
            ? "The chain has not answered yet; the public endpoint may be rate-limited. This page keeps trying every few seconds, or read status.json, the keeper's own account of what is ready."
            : "Reading the vault, the hook and the feed…"}
        </div>
      ) : (
        <div className="duties">
          {rows.map((d) => (
            <DutyRow key={d.id} d={d} busy={busy} go={go} />
          ))}
        </div>
      )}

      <h2 className="serif sub-h">Who ran it</h2>
      <p className="lede">
        The last flushes, seat purchases and burns from the chain&apos;s events, newest first, with what the vault paid the
        caller. A flush names no caller in its event, so the sender of the transaction stands for it.
      </p>
      {loading ? null : s.runs.length === 0 ? (
        <div className="empty">Nothing has run yet.</div>
      ) : (
        <div className="panel tablewrap runs">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Step</th>
                <th>Caller</th>
                <th className="num">ETH</th>
                <th className="num">PUPATE burned</th>
                <th className="num">Reward</th>
                <th aria-label="Transaction" />
              </tr>
            </thead>
            <tbody>
              {s.runs.map((r, i) => (
                <tr key={`${r.tx ?? r.when}-${i}`}>
                  <td className="num">{r.when}</td>
                  <td>{KIND[r.kind]}</td>
                  <td className="num">
                    {r.address && explorer ? (
                      <a href={`${explorer}/address/${r.address}`} target="_blank" rel="noreferrer">
                        {r.who}
                      </a>
                    ) : (
                      r.who
                    )}
                    {me && r.who === me ? <span className="chip jade">you</span> : null}
                  </td>
                  <td className="num">{eth(r.eth, r.eth > 0 && r.eth < 0.01 ? 5 : 4)}</td>
                  <td className="num">{r.pupate ? int(r.pupate) : "–"}</td>
                  <td className="num">{r.reward ? eth(r.reward, 5) : "–"}</td>
                  <td>
                    {r.tx && explorer ? (
                      <a href={`${explorer}/tx/${r.tx}`} target="_blank" rel="noreferrer">
                        tx ↗
                      </a>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel agents" id="agents">
        <div>
          <div className="label jade">For agents</div>
          <div className="serif t">The same duties, as a skill</div>
          <p className="dim">
            skill.md tells an agent what each step is, when it can run, what it pays and how it fails, with the reads to make
            first. status.json is the keeper&apos;s own account of what is ready right now, rewritten after every tick, so one
            fetch replaces the reads.
          </p>
        </div>
        <div className="agents-actions">
          <a className="btn primary" href={SKILL} target="_blank" rel="noreferrer">
            Open skill.md <span className="arrow">→</span>
          </a>
          <a className="btn" href="/status.json" target="_blank" rel="noreferrer">
            status.json
          </a>
        </div>
      </div>
    </section>
  );
}
