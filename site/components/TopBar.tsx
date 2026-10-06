"use client";

import { useEffect, useState } from "react";
import { useDispatch, useSim } from "./SimContext";

function effectiveDark(): boolean {
  if (typeof document === "undefined") return false;
  const t = document.documentElement.getAttribute("data-theme");
  if (t) return t === "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function TopBar() {
  const s = useSim();
  const dispatch = useDispatch();
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(effectiveDark()), []);

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
        <a className="logo" href="#top" aria-label="Pupate home">
          <span aria-hidden="true">◇</span>
          <span>PUPATE</span>
        </a>
        <nav className="nav" aria-label="Sections">
          <a href="#feed">Feed</a>
          <a href="#cocoon">Cocoon</a>
          <a href="#emerge">Emerge</a>
          <a href="#steps">Steps</a>
          <a href="https://imd.fun/docs/" target="_blank" rel="noreferrer">
            IMD
          </a>
        </nav>
        <div className="right">
          <button className="iconbtn" onClick={toggleTheme} aria-label={dark ? "Switch to light" : "Switch to dark"}>
            {dark ? "☼" : "☾"}
          </button>
          <button className="btn" onClick={() => dispatch({ type: "connect" })}>
            {s.wallet ? s.wallet : "Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}
