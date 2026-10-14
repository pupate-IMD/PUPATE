"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";
import { usePublicClient } from "wagmi";
import { TARGET_CHAIN_ID } from "@/lib/addresses";
import { cachedImage, cardFacts, stageWord, tokenCard } from "@/lib/metamorph/cards";
import { errorText } from "@/lib/metamorph/mint";
import { useContracts, useWallet } from "./Workspace";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const SUPPLY = 3333;

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="lead">
      <span className="k">{k}</span>
      <span className="dots" aria-hidden="true" />
      <span className="v num">{v}</span>
    </div>
  );
}

/// One card's page (/cards/view/?id=n), drawn in the browser: its image large from tokenURI, its facts from
/// the token (the stage read live, the stake, the holder), and the attributes its JSON lists.
export function CardView() {
  const raw = useSearchParams().get("id") ?? "";
  const id = /^\d{1,4}$/.test(raw) ? Number(raw) : 0;
  const valid = id >= 1 && id <= SUPPLY;
  const contracts = useContracts();
  const wallet = useWallet();
  const client = usePublicClient({ chainId: TARGET_CHAIN_ID });
  const facts = useQuery({
    queryKey: ["metamorph-card", contracts?.chainId, contracts?.metamorph, id],
    queryFn: () => cardFacts(client!, contracts!, id),
    enabled: !!contracts && !!client && valid,
    refetchInterval: 15_000,
    staleTime: 5_000,
    retry: 1,
  });
  const f = facts.data;
  // The JSON once per stage: an emerged card is read again.
  const json = useQuery({
    queryKey: ["metamorph-json", contracts?.chainId, contracts?.metamorph, id, f?.stage],
    queryFn: () => tokenCard(client!, contracts!, id),
    enabled: !!contracts && !!client && !!f,
    staleTime: Infinity,
    retry: 1,
  });
  const image = json.data?.image ?? (contracts && f ? cachedImage(contracts, id, f.stage, f.gilt) : null);

  let body;
  if (!valid) {
    body = <p className="ws-empty dim">There is no card {raw ? `#${raw}` : "without a number"}: cards are numbered 1 to 3,333.</p>;
  } else if (contracts === null) {
    body = <p className="ws-empty dim">Preview: the contracts are not live yet, so no card is minted.</p>;
  } else if (contracts === undefined || facts.isPending) {
    body = <p className="ws-empty dim">Reading Metamorph.md #{id}…</p>;
  } else if (facts.error && !f) {
    body = <p className="ws-empty alarm">The card could not be read: {errorText(facts.error)}</p>;
  } else if (!f) {
    body = (
      <p className="ws-empty dim">
        Metamorph.md #{id} is not minted yet. <Link href="/mine/">Mine it →</Link>
      </p>
    );
  } else {
    const mine = !!wallet && !!f.owner && f.owner.toLowerCase() === wallet.toLowerCase();
    body = (
      <div className="cv-grid">
        <figure className="cv-plate">
          {image ? (
            <img src={image} alt={`Metamorph.md #${id}, seat identity.md #${f.seat}, ${stageWord(f.stage)}${f.gilt ? ", gilt" : ""}`} width={1080} height={1080} decoding="async" />
          ) : (
            <span className="tile-wait" role="img" aria-label={`Metamorph.md #${id}`}>
              {json.error ? "no image" : ""}
            </span>
          )}
        </figure>
        <div className="cv-facts">
          <h1 className="serif">Metamorph.md #{id}</h1>
          <p className="cv-marks">
            <span>{stageWord(f.stage)}</span>
            {f.gilt ? <span className="mark gilt">gilt</span> : null}
            {f.staked ? <span className="mark staked">staked</span> : null}
            {mine ? <span className="chip jade">yours</span> : null}
          </p>
          {json.data?.description ? <p className="dim cv-desc">{json.data.description}</p> : null}
          <div className="rows">
            <Row k="seat" v={`identity.md #${f.seat}`} />
            <Row k="edition" v={`${f.edition} of 303 · round ${f.round}`} />
            <Row k="mint price paid" v={`${Number(formatUnits(f.paid, 18)).toLocaleString("en-US", { maximumFractionDigits: 0 })} PUPATE`} />
            <Row k="minted" v={`${new Date(f.mintedAt * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`} />
            <Row k="miner" v={short(f.miner)} />
            <Row k="held by" v={f.owner ? short(f.owner) : "—"} />
          </div>
          {json.data?.attributes.length ? (
            <>
              <h2 className="serif cv-h">Attributes</h2>
              <dl className="cv-attrs">
                {json.data.attributes.map((x) => (
                  <div key={x.trait}>
                    <dt>{x.trait}</dt>
                    <dd>{x.value}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <section className="wrap card-view" aria-label="A card">
      <Link className="cv-back" href="/cards/">
        ← your cards and the gallery
      </Link>
      {body}
    </section>
  );
}
