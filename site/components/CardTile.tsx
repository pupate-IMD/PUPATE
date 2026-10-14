"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { usePublicClient } from "wagmi";
import { TARGET_CHAIN_ID } from "@/lib/addresses";
import { cachedImage, stageWord, tokenImage } from "@/lib/metamorph/cards";
import type { LiveAddresses } from "@/lib/metamorph/job";

/// What a tile shows of a card.
export interface TileCard {
  id: number;
  seat: number;
  /// 0 in the cocoon, 1 emerged; null while it is being read.
  stage: number | null;
  gilt: boolean;
  staked?: boolean;
}

/// True once the element has come near the viewport (and from then on): the tile reads its image then.
function useSeen(ref: RefObject<Element | null>): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: "240px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, seen]);
  return seen;
}

/// A minted card's image from its tokenURI: the cached one at once, else read when the tile is seen. Undefined
/// while it is not read yet, null when the read failed.
function useCardImage(contracts: LiveAddresses | null, card: TileCard, seen: boolean): string | null | undefined {
  const client = usePublicClient({ chainId: TARGET_CHAIN_ID });
  const { id, stage, gilt } = card;
  const key = contracts && stage !== null ? `${contracts.chainId}:${contracts.metamorph}:${id}:${stage}:${gilt}` : "";
  const cached = contracts && stage !== null ? cachedImage(contracts, id, stage, gilt) : null;
  const [read, setRead] = useState<{ key: string; src: string | null } | null>(null);
  useEffect(() => {
    if (!seen || !contracts || !client || stage === null || cached) return;
    let on = true;
    tokenImage(client, contracts, id, stage, gilt).then(
      (src) => on && setRead({ key, src }),
      () => on && setRead({ key, src: null }),
    );
    return () => {
      on = false;
    };
  }, [seen, contracts, client, id, stage, gilt, cached, key]);
  if (cached) return cached;
  return read?.key === key ? read.src : undefined;
}

interface Props {
  card: TileCard;
  /// The token, for a minted card's image; null with `src`, a preview card's own picture.
  contracts: LiveAddresses | null;
  src?: string;
  /// The gallery: the tile opens the card's page.
  href?: string;
  /// The workspace: the tile is a toggle, and a small link opens the card's page.
  selected?: boolean;
  onToggle?: () => void;
  open?: string;
}

/// One card: its image (from tokenURI, as an <img>; never the SVG inlined), its number, its stage in the
/// page's words, the gilt and staked marks, and its seat.
export function CardTile({ card, contracts, src, href, selected, onToggle, open }: Props) {
  const ref = useRef<HTMLLIElement>(null);
  const seen = useSeen(ref);
  const read = useCardImage(src ? null : contracts, card, seen);
  const picture = src ?? read;
  const stage = card.stage === null ? null : stageWord(card.stage);
  const alt = `Metamorph.md #${card.id}, seat identity.md #${card.seat}${stage ? `, ${stage}` : ""}${card.gilt ? ", gilt" : ""}`;
  const face: ReactNode = (
    <>
      <span className="tile-img">
        {picture ? (
          <img src={picture} alt={alt} width={360} height={360} loading="lazy" decoding="async" />
        ) : (
          <span className="tile-wait" role="img" aria-label={alt}>
            {picture === null ? "no image" : ""}
          </span>
        )}
      </span>
      <span className="tile-cap">
        <span className="tile-id serif">#{card.id}</span>
        <span className="tile-stage">{stage ?? "…"}</span>
        {card.gilt ? <span className="mark gilt">gilt</span> : null}
        {card.staked ? <span className="mark staked">staked</span> : null}
        <span className="tile-seat">seat identity.md #{card.seat}</span>
      </span>
    </>
  );
  return (
    <li ref={ref} className={`tile${selected ? " on" : ""}`}>
      {onToggle ? (
        <button type="button" aria-pressed={!!selected} onClick={onToggle}>
          {face}
        </button>
      ) : href ? (
        <Link href={href}>{face}</Link>
      ) : (
        <div>{face}</div>
      )}
      {open ? (
        <Link className="tile-open" href={open} aria-label={`Open Metamorph.md #${card.id}`}>
          open
        </Link>
      ) : null}
    </li>
  );
}
