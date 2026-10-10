"use client";

import Link from "next/link";
import { useState } from "react";

const KNOWN = [
  { name: "identity.md collection", address: "0x0000eC93127BAA929E58E97dd0095A2BFb38ec1D" },
  { name: "Seaport 1.6", address: "0x0000000000000068F116a894984e2DB1123eB395" },
  { name: "IMD token", address: "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7" },
  { name: "IMD oracle signer", address: "0x5598Aa9146215Bc13eb26f2c692Ad1461Fd32982" },
];
const PENDING = ["PUPATE token", "PupateHook", "Cocoon", "FloorFeed", "Timelock"];

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      // Clipboard refused: the address is selectable text right beside the button.
    }
  }
  return (
    <button className="chip" onClick={copy} type="button">
      {done ? "Copied" : "Copy"}
    </button>
  );
}

/// The footer: the ways out, and the contract addresses folded away until someone wants them.
export function Contracts() {
  return (
    <footer className="wrap foot">
      <div className="foot-row">
        <span className="serif">Pupate</span>
        <nav className="foot-links" aria-label="Elsewhere">
          <Link href="/how/">How it works</Link>
          <Link href="/mine/">Mine</Link>
          <Link href="/docs/">Docs</Link>
          <a href="https://github.com/pupate-IMD/PUPATE" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a href="https://x.com/pupateIMD" target="_blank" rel="noreferrer">
            X
          </a>
          <a href="https://imd.fun" target="_blank" rel="noreferrer">
            Built on IMD
          </a>
        </nav>
      </div>
      <details className="foot-contracts">
        <summary>Contracts</summary>
        <div className="addresses">
          {KNOWN.map((c) => (
            <div className="addr" key={c.address}>
              <span className="k">{c.name}</span>
              <a className="a num" href={`https://etherscan.io/address/${c.address}`} target="_blank" rel="noreferrer">
                {c.address}
              </a>
              <Copy text={c.address} />
            </div>
          ))}
          {PENDING.map((name) => (
            <div className="addr" key={name}>
              <span className="k">{name}</span>
              <span className="a faint">listed here with verified source once deployed</span>
            </div>
          ))}
        </div>
      </details>
      <div className="dim">
        Built with the IMD swarm, reviewed independently. This site describes a mechanism; it makes no statement about returns.
      </div>
    </footer>
  );
}
