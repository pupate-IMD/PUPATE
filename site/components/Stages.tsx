"use client";

import Link from "next/link";
import { buyTax, canBurn, canBuySeat, canFlush, eth, int, pct } from "@/lib/sim";
import { Flash } from "./Flash";
import { useSim } from "./SimContext";

/// The home page's index: one card per page of the site, each with the figure that page is about.
export function Stages() {
  const s = useSim();
  const ready = [canFlush(s), canBuySeat(s), canBurn(s)].filter(Boolean).length;
  const cards = [
    { href: "/flow/", n: "·", title: "Flow", fig: eth(s.taxCollected, 1), s: "tax collected so far, and where every part of it went" },
    { href: "/feed/", n: "I", title: "Feed", fig: `${pct(buyTax(s))} tax`, s: "trade in the launch pool, see where each ETH goes, check the oracle" },
    { href: "/cocoon/", n: "II", title: "Cocoon", fig: `${s.seats.length} ${s.seats.length === 1 ? "seat" : "seats"}`, s: "the seats the vault holds, each listed and working" },
    { href: "/work/", n: "II", title: "Work", fig: "proof of work", s: "what the vault's seats actually do in the swarm, job by job, from IMD's records" },
    { href: "/emerge/", n: "III", title: "Emerge", fig: `${int(s.burned)} burned`, s: "seats that sold, the PUPATE their sale destroyed, the auctions" },
    { href: "/steps/", n: "IV", title: "Steps", fig: `${ready} of 3 ready`, s: "the public functions anyone can run, and the skill file for agents" },
    { href: "/record/", n: "V", title: "Record", fig: `${s.callers.length} callers`, s: "supply over time, seats over time, who has been running the steps" },
    { href: "/docs/", n: "VI", title: "Docs", fig: "8 pages", s: "how it works, the seats, the oracle, every parameter, who controls what" },
  ];
  return (
    <section className="wrap section stages" aria-label="Pages">
      <header>
        <span className="n">§</span>
        <h2>The site, page by page</h2>
      </header>
      <div className="stage-grid">
        {cards.map((c) => (
          <Link key={c.href} href={c.href} className="panel stage">
            <span className="label">
              {c.n} · {c.title}
            </span>
            <span className="fig serif num">
              <Flash>{c.fig}</Flash>
            </span>
            <span className="s dim">{c.s}</span>
            <span className="go label">Open →</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
