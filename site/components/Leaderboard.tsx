"use client";

import { isAddressEqual } from "viem";
import { type Leader, leaderboard } from "@/lib/metamorph/cards";
import { useMinted } from "./Gallery";
import { useContracts, useWallet } from "./Workspace";

/// Rows shown before the connected wallet's own, when it ranks lower.
const TOP = 20;

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/// The miners ranked by the cards they minted, with their gilt cards; on equal counts the one with the newer
/// card first. From the same Minted logs as the gallery; the connected wallet's row is marked, and shown
/// under the top rows when it ranks below them. Nothing before the contracts exist.
export function Leaderboard() {
  const contracts = useContracts();
  const wallet = useWallet();
  const minted = useMinted(contracts ?? null);
  if (!contracts) return null;
  const rows = leaderboard(minted.data ?? []);
  const mine = wallet ? rows.findIndex((r) => isAddressEqual(r.miner, wallet)) : -1;
  const row = (r: Leader, rank: number) => {
    const you = !!wallet && isAddressEqual(r.miner, wallet);
    return (
      <tr key={r.miner} className={you ? "me" : undefined}>
        <td className="num">{rank}</td>
        <td>
          <span title={r.miner}>{short(r.miner)}</span>
          {you ? <span className="chip jade you">you</span> : null}
        </td>
        <td className="num">{r.cards.toLocaleString("en-US")}</td>
        <td className="num">{r.gilt ? r.gilt.toLocaleString("en-US") : <span className="dim">0</span>}</td>
      </tr>
    );
  };
  return (
    <section className="wrap leaders" aria-label="The leaderboard">
      <div className="sec-head">
        <h2 className="serif">The leaderboard</h2>
        <span className="dim">miners by cards minted</span>
      </div>
      {!minted.data ? (
        <p className="ws-empty dim">{minted.error ? "The mints could not be read. The page tries again in a moment." : "Reading the mints…"}</p>
      ) : rows.length === 0 ? (
        <p className="ws-empty dim">Nobody has mined a card yet.</p>
      ) : (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th className="num">#</th>
                <th>miner</th>
                <th className="num">cards</th>
                <th className="num">gilt</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, TOP).map((r, i) => row(r, i + 1))}
              {mine >= TOP ? (
                <>
                  <tr className="gap" aria-hidden="true">
                    <td colSpan={4}>…</td>
                  </tr>
                  {row(rows[mine], mine + 1)}
                </>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
