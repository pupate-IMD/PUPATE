"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ConnectWallet } from "./ConnectWallet";

/// Four doors. Everything technical sits behind the last one; InsideBar names those pages.
const PAGES = [
  { href: "/buy/", label: "Buy" },
  { href: "/how/", label: "How it works" },
  { href: "/work/", label: "Work" },
  { href: "/inside/", label: "Under the hood" },
];

/// The paths of the technical layer, framed by Shell's "inside" variant.
export const INSIDE = ["/inside", "/flow", "/feed", "/cocoon", "/emerge", "/steps", "/record", "/seat", "/docs"];

function activeDoor(path: string): string | null {
  if (path.startsWith("/buy")) return "/buy/";
  if (path.startsWith("/how")) return "/how/";
  if (path.startsWith("/work")) return "/work/";
  if (INSIDE.some((p) => path.startsWith(p))) return "/inside/";
  return null;
}

function effectiveDark(): boolean {
  if (typeof document === "undefined") return false;
  const t = document.documentElement.getAttribute("data-theme");
  if (t) return t === "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function TopBar() {
  const [dark, setDark] = useState(false);
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setDark(effectiveDark()), []);
  const active = activeDoor(path);

  function toggleTheme() {
    const next = dark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("pupate-theme", next);
    } catch {}
    setDark(!dark);
  }

  return (
    <div className="topbar">
      <div className="wrap">
        <Link className="wordmark" href="/" aria-label="Pupate home">
          <svg viewBox="0 0 64 96" aria-hidden="true">
            <path d="M32 2v9" stroke="currentColor" strokeWidth="3" fill="none" />
            <path
              d="M32 11C16 18 11 38 14 58c3 17 10 30 18 35 8-5 15-18 18-35 3-20-2-40-18-47z"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
            />
            <path d="M32 30c-9 10-13 24-8 44 4-6 7-13 8-20 1 7 4 14 8 20 5-20 1-34-8-44z" fill="var(--jade)" />
          </svg>
          <span>
            Pu<em>pate</em>
          </span>
        </Link>
        <nav className={`nav ${open ? "open" : ""}`} aria-label="Sections">
          {PAGES.map((p) => {
            const on = active === p.href;
            return (
              <Link key={p.href} href={p.href} className={on ? "active" : undefined} aria-current={on ? "page" : undefined} onClick={() => setOpen(false)}>
                {p.label}
              </Link>
            );
          })}
        </nav>
        <div className="right">
          <button className="iconbtn" onClick={toggleTheme} aria-label={dark ? "Switch to light" : "Switch to dark"}>
            {dark ? "☼" : "☾"}
          </button>
          <ConnectWallet />
          <button className="iconbtn menu" onClick={() => setOpen(!open)} aria-label="Menu" aria-expanded={open}>
            {open ? "×" : "≡"}
          </button>
        </div>
      </div>
    </div>
  );
}
