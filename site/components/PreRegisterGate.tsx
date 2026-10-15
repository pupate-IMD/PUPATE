"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PreRegister } from "./PreRegister";

/// Closed for this browser session with the link under the form.
const LATER_KEY = "metamorph:prereg:later";
/// On the list from this browser, new or already there: the gate stays closed and the pill goes.
const DONE_KEY = "metamorph:prereg:done";
/// How long the list's answer stays up before the gate closes by itself.
const LINGER_MS = 2000;

/// Open over the page, closed for now (the pill shows), or done (nothing shows).
type Shown = "open" | "closed" | "done";

/// Children of <body> that show nothing, so are not made inert (Next renders the metadata into the body).
const NOT_SHOWN = new Set(["SCRIPT", "STYLE", "LINK", "META", "TITLE"]);

/// What this browser remembers: done outlives the session, later ends with it.
function readShown(): Shown {
  try {
    if (localStorage.getItem(DONE_KEY) === "1") return "done";
  } catch {}
  try {
    if (sessionStorage.getItem(LATER_KEY) === "1") return "closed";
  } catch {}
  return "open";
}

function keepLater(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(LATER_KEY, "1");
    else sessionStorage.removeItem(LATER_KEY);
  } catch {}
}

function keepDone(): void {
  try {
    localStorage.setItem(DONE_KEY, "1");
  } catch {}
}

/// The pre-register card as a gate over the mine page: on arrival the page is blurred and dimmed behind it,
/// locked against scrolling and inert, and the card (PreRegister.tsx, as it was) sits centred in its frame.
/// Nothing closes it but the link under the form, for this session; a pill at the bottom right then brings
/// it back. A registration, or "already registered", closes it for good from this browser. Mine.tsx renders
/// the gate only while preRegister holds, so nothing here decides whether the card exists.
export function PreRegisterGate() {
  // Null until mounted: the server and the first client render show nothing, so the static HTML carries no
  // form and a visitor who put it aside sees no flash of it.
  const [shown, setShown] = useState<Shown | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => setShown(readShown()), []);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const open = shown === "open";
  // While the gate is up, everything else under <body> is inert and the page cannot scroll (the scrollbar's
  // width stays as padding, so the page behind does not shift). Focus moves into the gate; when it closes,
  // focus goes back where it was, or to the pill when the gate opened on arrival.
  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const made: HTMLElement[] = [];
    for (const el of Array.from(document.body.children)) {
      if (el === root.current || !(el instanceof HTMLElement) || NOT_SHOWN.has(el.tagName) || el.inert) continue;
      el.inert = true;
      made.push(el);
    }
    const gap = window.innerWidth - html.clientWidth;
    html.classList.add("prereg-locked");
    if (gap > 0) html.style.paddingRight = `${gap}px`;
    const before = document.activeElement;
    dialog.current?.focus({ preventScroll: true });
    return () => {
      for (const el of made) el.inert = false;
      html.classList.remove("prereg-locked");
      html.style.paddingRight = "";
      const back = before instanceof HTMLElement && before !== document.body && before.isConnected ? before : root.current?.querySelector<HTMLElement>(".prereg-pill");
      back?.focus({ preventScroll: true });
    };
  }, [open]);

  const later = useCallback(() => {
    keepLater(true);
    setShown("closed");
  }, []);
  const reopen = useCallback(() => {
    keepLater(false);
    setShown("open");
  }, []);
  // The answer stays up for a moment; then the gate closes for good.
  const listed = useCallback(() => {
    keepDone();
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setShown("done"), LINGER_MS);
  }, []);

  if (shown === null || shown === "done") return null;
  return createPortal(
    <div ref={root}>
      {open ? (
        <div className="prereg-backdrop">
          <div ref={dialog} className="prereg-gate" role="dialog" aria-modal="true" aria-labelledby="prereg-title" tabIndex={-1}>
            <PreRegister onListed={listed} onLater={later} />
          </div>
        </div>
      ) : (
        <button type="button" className="btn prereg-pill" onClick={reopen}>
          Pre-register
        </button>
      )}
    </div>,
    document.body,
  );
}
