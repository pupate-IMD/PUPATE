"use client";

import { useEffect, useRef, useState } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { type Address, getAddress, isAddress } from "viem";
import { useAccount } from "wagmi";

/// The list's Worker (waitlist/), baked in at build time; empty, and Mine.tsx leaves the card out.
export const PREREGISTER_URL = (process.env.NEXT_PUBLIC_PREREGISTER_URL ?? "").replace(/\/+$/, "");
/// An X username: letters, digits and underscores, fifteen at most; the "@" is shown, never kept.
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const X_URL = "https://x.com/pupateIMD";
/// The follow check, remembered across visits.
const FOLLOWED_KEY = "metamorph:prereg:followed";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function readFollowed(): boolean {
  try {
    return localStorage.getItem(FOLLOWED_KEY) === "1";
  } catch {
    return false;
  }
}

function keepFollowed(): void {
  try {
    localStorage.setItem(FOLLOWED_KEY, "1");
  } catch {}
}

/// A temporary card while the mine has not opened: an X username, a follow on the honour system, a wallet
/// (or an address pasted in), and one press that puts the entry on the list. Nothing is signed and nothing is
/// sent before that press. PreRegisterGate.tsx shows it in a pop-up over the page: `onListed` tells the gate
/// the entry is on the list (new, or there already). The mine has no allowlist, and the card goes when mining
/// opens. The page reads nothing from the list; the owner has the count.
export function PreRegister({ onListed }: { onListed?: () => void }) {
  const { address, isConnected } = useAccount();
  const wallet: Address | null = isConnected && address ? getAddress(address) : null;
  const { openConnectModal } = useConnectModal();
  const [handle, setHandle] = useState("");
  const [followed, setFollowed] = useState(false);
  const clicked = useRef(false);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  // The honeypot: a field off the page, which a person never fills.
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [note, setNote] = useState<{ text: string; tone: "dim" | "alarm" } | null>(null);

  // The follow check from an earlier visit.
  useEffect(() => {
    if (readFollowed()) setFollowed(true);
  }, []);

  // The page comes back from X after the follow button was pressed: the honour system's check.
  useEffect(() => {
    const back = () => {
      if (!clicked.current || document.visibilityState === "hidden") return;
      clicked.current = false;
      keepFollowed();
      setFollowed(true);
    };
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", back);
    return () => {
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", back);
    };
  }, []);

  const handleOk = HANDLE.test(handle);
  const pastedOk = pasted !== "" && isAddress(pasted);
  /// The address the entry is for: pasted and checksummed, or the wallet's.
  const chosen: Address | null = pasting ? (pastedOk ? getAddress(pasted) : null) : wallet;
  const canRegister = handleOk && followed && !!chosen && !busy;

  async function register() {
    if (!handleOk || !followed || !chosen) return;
    setBusy(true);
    setNote(null);
    try {
      const body = { handle, address: chosen, followed, website };
      const res = await fetch(`${PREREGISTER_URL}/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.status === 409) {
        setNote({ text: "that handle or address is already registered.", tone: "alarm" });
        onListed?.();
      }
      else if (res.status === 429) setNote({ text: "too many tries from your connection; wait a minute.", tone: "alarm" });
      else if (!res.ok) setNote({ text: "try again, or paste the address instead.", tone: "alarm" });
      else {
        setDone(true);
        onListed?.();
      }
    } catch {
      setNote({ text: "the list did not answer, try again.", tone: "alarm" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel prereg" aria-label="Pre-register">
      <header className="prereg-head">
        <div>
          <h2 className="serif" id="prereg-title">
            Be there when it opens.
          </h2>
          <p className="prereg-lede">Leave your X name and an address, and you hear before the mine opens.</p>
        </div>
      </header>
      {done ? (
        <p className="done" role="status">
          {"You're on the waitlist."}
        </p>
      ) : (
        <ol className="prereg-steps">
          <li className={handleOk ? "on" : undefined}>
            <span className="n">1</span>
            <div className="row">
              <label className="k" htmlFor="prereg-handle">
                X username
              </label>
              <span className="prereg-field">
                <span className="at" aria-hidden="true">
                  @
                </span>
                <input
                  id="prereg-handle"
                  value={handle}
                  onChange={(e) => setHandle(e.target.value.replace(/^@+/, ""))}
                  maxLength={15}
                  placeholder="yourname"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  aria-invalid={handle !== "" && !handleOk}
                />
              </span>
              {handle !== "" && !handleOk ? <span className="hint alarm">letters, digits and _ only; no spaces, no links</span> : null}
            </div>
          </li>
          <li className={followed ? "on" : undefined}>
            <span className="n">2</span>
            <div className="row">
              <span className="k">follow</span>
              {followed ? (
                <span className="check">✓ Following</span>
              ) : (
                <a
                  className="btn"
                  href={X_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    clicked.current = true;
                  }}
                >
                  Follow @pupateIMD on X
                </a>
              )}
            </div>
          </li>
          <li className={chosen ? "on" : followed ? undefined : "off"}>
            <span className="n">3</span>
            <div className="row">
              <span className="k">wallet</span>
              {!followed ? (
                <span className="hint">after the follow</span>
              ) : pasting ? (
                <>
                  <span className="prereg-field wide">
                    <input
                      value={pasted}
                      onChange={(e) => setPasted(e.target.value.trim())}
                      placeholder="0x…"
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      aria-label="Ethereum address"
                      aria-invalid={pasted !== "" && !pastedOk}
                    />
                  </span>
                  {pasted !== "" && !pastedOk ? <span className="hint alarm">not an Ethereum address</span> : null}
                </>
              ) : wallet ? (
                <span className="num" title={wallet}>
                  {short(wallet)}
                </span>
              ) : (
                <button type="button" className="btn" onClick={() => openConnectModal?.()}>
                  Connect wallet
                </button>
              )}
              {followed ? (
                <button type="button" className="mine-alt" onClick={() => setPasting(!pasting)}>
                  {pasting ? "use a wallet instead" : "paste an address instead"}
                </button>
              ) : null}
            </div>
          </li>
          <li>
            <span className="n">4</span>
            <div className="row">
              <span className="k">register</span>
              <button type="button" className="btn primary" disabled={!canRegister} onClick={() => void register()}>
                {busy ? "Sending…" : "Register"}
              </button>
              {note ? (
                <span className={`hint ${note.tone}`} role="status">
                  {note.text}
                </span>
              ) : null}
            </div>
          </li>
        </ol>
      )}
      <input className="prereg-trap" type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" value={website} onChange={(e) => setWebsite(e.target.value)} />
    </section>
  );
}
