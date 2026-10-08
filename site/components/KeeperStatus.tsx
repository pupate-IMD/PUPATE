"use client";

import { useEffect, useState } from "react";
import { useSim } from "./SimContext";

// The keeper's own account of itself: /status.json, which it rewrites after every tick (schema
// pupate-status/1, see keeper/README.md). Live mode only. Nothing renders until the file has been
// read, and nothing at all when it is missing, so a site without a keeper shows no empty panel.

const STATUS = "/status.json";
const LISTINGS = "/listings.json";
const EVERY_MS = 30_000;
const STALE_AFTER_S = 10 * 60;
const SHOW_ACTIONS = 5;

interface KeeperAction {
  at: string;
  action: string;
  hash: string;
  gasUsed: string;
  status?: string;
}

interface Step {
  ready: boolean;
  why: string;
}

interface Status {
  schema: string;
  generatedAt: string;
  block: number;
  steps: Record<string, Step>;
  keeper: { lastTickAt: string | null; lastActions: KeeperAction[]; listingSource: string; dryRun: boolean };
}

const STEP_NAMES: Record<string, string> = {
  flush: "flush",
  buySeat: "buy a seat",
  settle: "settle a seat",
  burn: "burn",
  startImdAuction: "start the IMD auction",
  startAuction: "start an auction",
  report: "report the floor",
};

/// "just now", "4 min ago", "3 h ago"; stale past ten minutes, as a keeper on a 15 s loop never is.
function since(iso: string | null, now: number): { text: string; stale: boolean } {
  if (!iso) return { text: "never", stale: true };
  const sec = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  const stale = sec > STALE_AFTER_S;
  if (sec < 60) return { text: "just now", stale };
  const min = Math.floor(sec / 60);
  if (min < 60) return { text: `${min} min ago`, stale };
  const h = Math.floor(min / 60);
  if (h < 48) return { text: `${h} h ago`, stale };
  return { text: `${Math.floor(h / 24)} d ago`, stale };
}

const shortHash = (h: string) => (h ? `${h.slice(0, 10)}…${h.slice(-4)}` : "");
const stamp = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(5, 16).replace("T", " ") : "";
};

export function KeeperStatus() {
  const live = !!useSim().live;
  const [status, setStatus] = useState<Status | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!live) return;
    let on = true;
    const load = async () => {
      try {
        const res = await fetch(STATUS, { cache: "no-store" });
        const json = res.ok ? ((await res.json()) as Status) : null;
        if (on) setStatus(json && json.schema === "pupate-status/1" && json.keeper ? json : null);
      } catch {
        if (on) setStatus(null);
      }
      if (on) setNow(Date.now());
    };
    void load();
    const t = setInterval(load, EVERY_MS);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [live]);

  if (!live || !status) return null;
  const tick = since(status.keeper.lastTickAt, now);
  const actions = status.keeper.lastActions.slice(-SHOW_ACTIONS).reverse();
  const ready = Object.entries(status.steps ?? {}).filter(([, st]) => st.ready);

  return (
    <div className="panel keeper" role="status" aria-label="Keeper status" data-keeper-status>
      <div className="head">
        <div>
          <span className="label">Keeper</span>
          <div className={`serif t ${tick.stale ? "alarm" : "jade"}`}>last tick {tick.text}</div>
        </div>
        <div className="chips">
          {status.keeper.dryRun ? <span className="chip gold">dry run</span> : null}
          <span className="chip num">block {status.block.toLocaleString("en-US")}</span>
          <span className="chip">listings · {status.keeper.listingSource}</span>
        </div>
      </div>

      <div className="lead">
        <span className="k">Ready now</span>
        <span className="dots" />
        <span className="v ready">
          {ready.length ? (
            ready.map(([k]) => (
              <span className="chip jade" key={k}>
                {STEP_NAMES[k] ?? k}
              </span>
            ))
          ) : (
            <span className="dim">nothing — every step is waiting on its condition</span>
          )}
        </span>
      </div>

      <ol className="acts" aria-label="Last actions">
        {actions.length === 0 ? (
          <li className="dim">No transaction sent yet.</li>
        ) : (
          actions.map((x) => (
            <li key={`${x.hash}-${x.at}`}>
              <span className="faint num">{stamp(x.at)}</span>
              <span>
                {x.action}
                {x.status === "reverted" ? <span className="alarm"> · reverted</span> : null}
              </span>
              <span className="num dim" title={x.hash}>
                {shortHash(x.hash)}
              </span>
            </li>
          ))
        )}
      </ol>

      <div className="links">
        <a href={STATUS} target="_blank" rel="noreferrer">
          status.json ↗
        </a>
        <a href={LISTINGS} target="_blank" rel="noreferrer">
          listings.json ↗
        </a>
      </div>
    </div>
  );
}
