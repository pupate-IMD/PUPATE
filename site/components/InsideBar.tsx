"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { TARGET_CHAIN_ID } from "@/lib/addresses";
import { hm } from "@/lib/sim";
import { useSim } from "./SimContext";

const CHAIN_NAME: Record<number, string> = { 1: "Ethereum", 11155111: "Sepolia", 31337: "local fork" };
const PAGES = [
  { href: "/inside/", label: "Overview" },
  { href: "/flow/", label: "Flow" },
  { href: "/feed/", label: "Feed" },
  { href: "/cocoon/", label: "Cocoon" },
  { href: "/emerge/", label: "Emerge" },
  { href: "/steps/", label: "Steps" },
  { href: "/record/", label: "Record" },
  { href: "/docs/", label: "Docs" },
];

/// The strip under the bar on the technical pages: where you are under the hood, and whether the
/// figures are live or a sample. The simulation's controls live on the overview page (TryControls).
export function InsideBar() {
  const s = useSim();
  const path = usePathname();
  const here = path.startsWith("/seat") ? "/cocoon/" : path;
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 15_000);
    return () => clearInterval(t);
  }, []);
  const live = s.live;
  const left = live ? live.freshUntil - now : 0;

  return (
    <div className={`inside-bar ${live ? "live" : ""}`} role="navigation" aria-label="Under the hood">
      <div className="wrap">
        <span className="label">Under the hood</span>
        <nav className="sub">
          {PAGES.map((p) => {
            const active = p.href === "/inside/" ? here === "/inside/" || here === "/inside" : here.startsWith(p.href.slice(0, -1));
            return (
              <Link key={p.href} href={p.href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
                {p.label}
              </Link>
            );
          })}
        </nav>
        <span className="status dim num">
          {live ? (
            <>
              <span className="jade">Live · {CHAIN_NAME[TARGET_CHAIN_ID] ?? `chain ${TARGET_CHAIN_ID}`}</span> · block{" "}
              {live.block.toLocaleString("en-US")} · oracle report {live.fresh ? `fresh for ${hm(Math.max(left, 0))}` : "stale, the vault is not buying"}
              {live.pending ? ` · ${live.pending}, waiting for the block…` : ""}
            </>
          ) : (
            <>
              Sample figures, simulated buttons · <Link href="/inside/#try">try the mechanism</Link>
            </>
          )}
        </span>
      </div>
    </div>
  );
}
