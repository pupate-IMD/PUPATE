"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PreRegister } from "./PreRegister";

/// On the list from this browser, new or already there: the gate never shows again.
const DONE_KEY = "metamorph:prereg:done";
/// How long the list's answer stays up before the gate closes by itself.
const LINGER_MS = 2000;

/// Open over the page, or done (nothing shows).
type Shown = "open" | "done";

/// Children of <body> that show nothing, so are not made inert (Next renders the metadata into the body).
const NOT_SHOWN = new Set(["SCRIPT", "STYLE", "LINK", "META", "TITLE"]);

/// What this browser remembers: done outlives the session.
function readShown(): Shown {
  try {
    if (localStorage.getItem(DONE_KEY) === "1") return "done";
  } catch {}
  return "open";
}

function keepDone(): void {
  try {
    localStorage.setItem(DONE_KEY, "1");
  } catch {}
}

/// The pre-register card as a gate over the mine page: on arrival the page is blurred and dimmed behind it,
/// locked against scrolling and inert, and the card (PreRegister.tsx) sits centred in its frame. Nothing
/// closes it but a registration, or "already registered", which closes it for good from this browser.
/// Mine.tsx renders the gate only while preRegister holds, so nothing here decides whether the card exists.
export function PreRegisterGate() {
  // Null until mounted: the server and the first client render show nothing, so the static HTML carries no
  // form and a visitor who registered sees no flash of it.
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
  // focus goes back where it was.
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
      if (before instanceof HTMLElement && before !== document.body && before.isConnected) before.focus({ preventScroll: true });
    };
  }, [open]);

  // The answer stays up for a moment; then the gate closes for good.
  const listed = useCallback(() => {
    keepDone();
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setShown("done"), LINGER_MS);
  }, []);

  if (!open) return null;
  return createPortal(
    <div ref={root}>
      <div className="prereg-backdrop">
        <div ref={dialog} className="prereg-gate" role="dialog" aria-modal="true" aria-labelledby="prereg-title" tabIndex={-1}>
          <PreRegister onListed={listed} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
