"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { TARGET_CHAIN_ID } from "@/lib/addresses";
import { mintedCards, stagesOf } from "@/lib/metamorph/cards";
import type { LiveAddresses } from "@/lib/metamorph/job";
import { CardTile } from "./CardTile";
import { useContracts } from "./Workspace";

/// Cards per page of the gallery.
export const PAGE = 24;
const SUPPLY = 3333;
/// The preview's cards (the mine page's): seat 1376's chrysalis, as 540 px WebP drawn from the prototype's SVG.
const PREVIEW = [1, 12, 57, 133, 240];

/// Every minted card from the Minted logs, newest first: one read for the gallery and the leaderboard, every
/// 15 seconds, each taking only the blocks it has not seen.
export function useMinted(contracts: LiveAddresses | null) {
  const client = usePublicClient({ chainId: TARGET_CHAIN_ID });
  return useQuery({
    queryKey: ["metamorph-minted", contracts?.chainId, contracts?.metamorph],
    queryFn: () => mintedCards(client!, contracts!),
    enabled: !!contracts && !!client,
    refetchInterval: 15_000,
    staleTime: 5_000,
    retry: 1,
  });
}

/// Every card minted, newest first, 24 to a page; each tile reads its image when it comes into view and opens
/// the card's page. Before the contracts exist, the five preview cards.
export function Gallery() {
  const contracts = useContracts();
  const client = usePublicClient({ chainId: TARGET_CHAIN_ID });
  const minted = useMinted(contracts ?? null);
  const [page, setPage] = useState(0);
  const rows = minted.data ?? [];
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const at = Math.min(page, pages - 1);
  const slice = rows.slice(at * PAGE, at * PAGE + PAGE);
  const ids = slice.map((r) => r.id);
  // The stage is read live for the cards on the page: it picks the image, so an emerged card shows emerged.
  // A new mint shifts the page's ids, and with them the query's key: the stages read before stay meanwhile,
  // so the page does not flash on every mint.
  const stages = useQuery({
    queryKey: ["metamorph-stages", contracts?.chainId, contracts?.metamorph, ids.join()],
    queryFn: () => stagesOf(client!, contracts!, ids),
    enabled: !!contracts && !!client && ids.length > 0,
    refetchInterval: 15_000,
    staleTime: 5_000,
    retry: 1,
    placeholderData: keepPreviousData,
  });
  // A card the chain does not have (its Minted log came from a reorganised block) leaves the page at once,
  // and the mints are read again without it.
  const gone = stages.data?.gone;
  const refetchMinted = minted.refetch;
  useEffect(() => {
    if (gone?.length) void refetchMinted();
  }, [gone, refetchMinted]);
  const shown = gone?.length ? slice.filter((r) => !gone.includes(r.id)) : slice;

  // Nothing until it is known whether the contracts are live: the preview never flashes before the live cards.
  if (contracts === undefined) return null;
  if (contracts === null) {
    return (
      <section className="wrap gallery" aria-label="The gallery">
        <div className="sec-head">
          <h2 className="serif">The gallery</h2>
          <span className="dim">five cards of seat identity.md #1376, as the art draws them</span>
        </div>
        <ul className="tiles">
          {PREVIEW.map((id) => (
            <CardTile key={id} card={{ id, seat: 1376, stage: 0, gilt: false }} contracts={null} src={`/cards/metamorph/c-${id}.webp`} />
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section className="wrap gallery" aria-label="The gallery">
      <div className="sec-head">
        <h2 className="serif">The gallery</h2>
        <span className="dim">
          {minted.data ? `${rows.length.toLocaleString("en-US")} of ${SUPPLY.toLocaleString("en-US")} minted · newest first` : "reading the mints…"}
        </span>
      </div>
      {minted.data && rows.length === 0 ? (
        <p className="ws-empty dim">
          No card is minted yet. <Link href="/mine/">Mine the first one →</Link>
        </p>
      ) : minted.error && !minted.data ? (
        <p className="ws-empty alarm">The mints could not be read. The page tries again in a moment.</p>
      ) : (
        <ul className="tiles">
          {shown.map((r) => (
            <CardTile
              key={r.id}
              card={{ id: r.id, seat: r.seat, gilt: r.gilt, stage: stages.data?.stages.get(r.id) ?? null }}
              contracts={contracts}
              href={`/cards/view/?id=${r.id}`}
            />
          ))}
        </ul>
      )}
      {pages > 1 ? (
        <nav className="g-pager" aria-label="Gallery pages">
          <button type="button" className="switch" disabled={at === 0} onClick={() => setPage(at - 1)}>
            ← newer
          </button>
          <span className="dim num">
            page {at + 1} of {pages}
          </span>
          <button type="button" className="switch" disabled={at >= pages - 1} onClick={() => setPage(at + 1)}>
            older →
          </button>
        </nav>
      ) : null}
    </section>
  );
}
