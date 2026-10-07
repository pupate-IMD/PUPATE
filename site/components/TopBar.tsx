"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ConnectWallet } from "./ConnectWallet";

const PAGES = [
  { href: "/flow/", label: "Flow" },
  { href: "/feed/", label: "Feed" },
  { href: "/cocoon/", label: "Cocoon" },
  { href: "/emerge/", label: "Emerge" },
  { href: "/steps/", label: "Steps" },
  { href: "/record/", label: "Record" },
  { href: "/docs/", label: "Docs" },
];

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
  // A seat sheet belongs to the cocoon.
  const here = path.startsWith("/seat") ? "/cocoon/" : path;

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
            const active = here.startsWith(p.href.slice(0, -1));
            return (
              <Link
                key={p.href}
                href={p.href}
                className={active ? "active" : undefined}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                {p.label}
              </Link>
            );
          })}
          <a href="https://imd.fun/docs/" target="_blank" rel="noreferrer">
            Built on IMD
          </a>
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
