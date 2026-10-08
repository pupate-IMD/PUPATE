"use client";

import { useState, type FormEvent } from "react";
import { pad4 } from "@/lib/sim";
import { ago, explorerAgent, useWorkFeed } from "@/lib/work";
import { SeatWorkCard } from "./SeatWork";
import { useSim } from "./SimContext";

/// Proof of work: the seats the vault holds, and what they have actually done in the IMD swarm,
/// from IMD's own records. Other projects prove hashes; Pupate proves work.
export function Work() {
  const s = useSim();
  const { feed, loading } = useWorkFeed();
  const [lookup, setLookup] = useState("");
  const held = feed ? feed.seats.filter((r) => r.held) : [];
  const featured = feed ? feed.seats.filter((r) => !r.held) : [];
  const online = held.filter((r) => r.paired && r.online).length;
  const accepted = held.reduce((a, r) => a + r.counts.accepted, 0);
  const id = Number(lookup.trim());
  const tracked = feed && Number.isInteger(id) && id > 0 ? feed.seats.find((r) => r.tokenId === id) : undefined;

  function go(e: FormEvent) {
    e.preventDefault();
    if (Number.isInteger(id) && id > 0 && !tracked) window.open(explorerAgent(id), "_blank", "noreferrer");
  }

  return (
    <section className="wrap section" id="work" aria-label="Proof of work">
      <header>
        <span className="n">II</span>
        <h2>Proof of work</h2>
        <p>
          A seat in the vault is not inventory waiting to be flipped: it is paired to a worker and takes jobs in the IMD
          swarm until the day it sells. This page shows that work as IMD records it, job by job, each one checkable on
          the explorer. The hashes are IMD&apos;s; the work is real.
        </p>
      </header>

      <div className="stats" style={{ marginBottom: 20 }}>
        <div className="panel stat">
          <div className="label">Seats held</div>
          <div className="v num">{s.live ? s.seats.length : feed ? feed.held.length : s.seats.length}</div>
          <div className="s">{feed ? `${online} online now` : "live count from the vault"}</div>
        </div>
        <div className="panel stat">
          <div className="label">Jobs accepted by held seats</div>
          <div className="v num">{feed ? accepted.toLocaleString("en-US") : "—"}</div>
          <div className="s">as judged by other seats</div>
        </div>
        <div className="panel stat">
          <div className="label">Record</div>
          <div className="v num" style={{ fontSize: 22 }}>
            {feed ? ago(feed.generatedAt) : loading ? "…" : "no feed yet"}
          </div>
          <div className="s">the keeper reads IMD each tick and publishes work.json</div>
        </div>
      </div>

      {!feed ? (
        <div className="empty">
          No work feed has been published yet. The keeper writes <span className="num">/work.json</span> from IMD&apos;s seat
          records each tick; until it runs, look any seat up on the explorer below.
        </div>
      ) : held.length === 0 ? (
        <div className="empty">
          The vault holds no seats yet. The first cocoon arrives when the seat pot reaches the reference price; from then
          on its work appears here.
        </div>
      ) : (
        <div className="work-grid">
          {held.map((r) => (
            <SeatWorkCard key={r.tokenId} rec={r} />
          ))}
        </div>
      )}

      {featured.length > 0 && (
        <>
          <h3 className="serif sub-h">What a working seat looks like</h3>
          <p className="lede">
            Seats already at work in the swarm, for scale. The vault&apos;s seats join this record the day they are paired.
          </p>
          <div className="work-grid">
            {featured.map((r) => (
              <SeatWorkCard key={r.tokenId} rec={r} compact />
            ))}
          </div>
        </>
      )}

      <h3 className="serif sub-h">Look a seat up</h3>
      <form className="proof-fetch" onSubmit={go} style={{ maxWidth: 480 }}>
        <input
          className="num"
          inputMode="numeric"
          value={lookup}
          onChange={(e) => setLookup(e.target.value)}
          placeholder="seat token id, e.g. 1477"
          aria-label="Seat token id"
        />
        <button className="btn" type="submit" disabled={!(Number.isInteger(id) && id > 0)}>
          {tracked ? `Seat ${pad4(id)} is above` : "Open on the explorer ↗"}
        </button>
      </form>
      <p className="dim" style={{ fontSize: 11, marginTop: 8, maxWidth: "72ch" }}>
        IMD&apos;s seat records are large and not readable from a browser, so this page shows the seats the keeper tracks;
        any other seat opens on IMD&apos;s explorer, which reads the same records.
      </p>
    </section>
  );
}
