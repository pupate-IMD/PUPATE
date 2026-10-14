"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { type Addresses, TARGET_CHAIN_ID, loadAddresses } from "@/lib/addresses";
import { metamorphAbi } from "@/lib/metamorph/abi";
import { type CardAction, actionIds, claimable, claimedIn, imd4, sendCards, walletCards } from "@/lib/metamorph/cards";
import type { LiveAddresses } from "@/lib/metamorph/job";
import { type WriteContract, errorText, isUserRejection, revertName } from "@/lib/metamorph/mint";
import { CardTile } from "./CardTile";
import { useAddresses } from "./SimContext";

/// The workspace's one sentence (the main spec's, word for word).
export const SENTENCE = "70% of every mint goes to the stakers as IMD; an emerged butterfly earns double.";

/// The addresses as this page loads them itself on a first visit, once: SimContext's arrive in the same way,
/// but its null means both "not loaded yet" and "none on this chain".
let loading: Promise<Addresses | null> | null = null;

/// The contracts on this chain; null for the preview; undefined while that is not known yet, so the page
/// never shows the preview for a moment before the live cards.
export function useContracts(): LiveAddresses | null | undefined {
  const shared = useAddresses();
  const [own, setOwn] = useState<Addresses | null | undefined>(undefined);
  useEffect(() => {
    if (shared) return;
    let on = true;
    (loading ??= loadAddresses()).then(
      (a) => on && setOwn(a),
      () => on && setOwn(null),
    );
    return () => {
      on = false;
    };
  }, [shared]);
  const a = shared ?? own;
  return a === undefined ? undefined : a?.metamorph ? (a as LiveAddresses) : null;
}

/// The connected wallet's address, from wagmi (the shared state keeps only its short form, for display).
export function useWallet(): Address | null {
  const { address, isConnected } = useAccount();
  return isConnected && address ? address : null;
}

/// "#3, #4", or "#3, #4 and 5 more" for a long list.
function cardList(ids: readonly number[]): string {
  const shown = ids.slice(0, 4).map((id) => `#${id}`).join(", ");
  return ids.length > 4 ? `${shown} and ${ids.length - 4} more` : shown;
}

/// Why the token refused a write, in the page's words.
function refusal(e: unknown): string {
  if (isUserRejection(e)) return "You declined in your wallet.";
  switch (revertName(e)) {
    case "Staked":
      return "A card in the selection is staked already.";
    case "NotStaked":
      return "A card in the selection is not staked from this wallet.";
    case "NotCardOwner":
      return "A card in the selection is no longer in this wallet.";
    default:
      return errorText(e);
  }
}

const LABEL: Record<CardAction, string> = { stake: "Stake", unstake: "Unstake", claim: "Claim IMD" };

/// The visitor's cards: each with its live image, stage, gilt and staked marks; a selection by tap; Stake,
/// Unstake and Claim IMD on it; the one figure, IMD earned and not claimed; the one sentence. Without a
/// wallet, a connect prompt (the gallery and the leaderboard follow on the page). Before the contracts
/// exist, the sentence and the preview note only.
export function Workspace() {
  const contracts = useContracts();
  const wallet = useWallet();
  const client = usePublicClient({ chainId: TARGET_CHAIN_ID });
  const { chainId: walletChain, status } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  const queryClient = useQueryClient();
  const chainRef = useRef(walletChain);
  chainRef.current = walletChain;

  // The wallet's writes as SimContext sends them: on the target chain, the wallet switched there first.
  const write = useCallback<WriteContract>(
    async (call) => {
      if (chainRef.current !== TARGET_CHAIN_ID) await switchChainAsync({ chainId: TARGET_CHAIN_ID });
      return writeContractAsync({ ...call, chainId: TARGET_CHAIN_ID });
    },
    [switchChainAsync, writeContractAsync],
  );

  // The wallet's cards and the figure: every 15 seconds, and again after each receipt.
  const cards = useQuery({
    queryKey: ["metamorph-wallet", contracts?.chainId, contracts?.metamorph, wallet],
    queryFn: () => walletCards(client!, contracts!, wallet!),
    enabled: !!contracts && !!client && !!wallet,
    refetchInterval: 15_000,
    staleTime: 5_000,
    retry: 1,
  });
  const read = cards.data;

  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [busy, setBusy] = useState<CardAction | null>(null);
  const [note, setNote] = useState<{ text: string; tone?: "jade" | "alarm" } | null>(null);

  // Another wallet starts with nothing selected and no note; a card that left the wallet leaves the selection.
  useEffect(() => {
    setSelected(new Set());
    setNote(null);
  }, [wallet]);
  useEffect(() => {
    if (!read) return;
    const held = new Set(read.cards.map((c) => c.id));
    setSelected((s) => ([...s].every((id) => held.has(id)) ? s : new Set([...s].filter((id) => held.has(id)))));
  }, [read]);

  const ids = useMemo(() => actionIds(read?.cards ?? [], selected), [read, selected]);
  const toClaim = read ? claimable(read, ids.claim) : 0n;
  const unsettled = read ? read.earned - read.pending : 0n;

  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  /// One write: checked against the chain first (a refusal never opens the wallet), signed, waited for; then
  /// the reads again, whatever happened.
  async function act(action: CardAction, list: number[]) {
    if (!contracts || !client || !wallet || busy) return;
    const label = action === "claim" ? LABEL.claim : `${LABEL[action]} ${cardList(list)}`;
    setBusy(action);
    setNote({ text: `${label}: sign in your wallet.` });
    try {
      await client.simulateContract({ address: contracts.metamorph, abi: metamorphAbi, functionName: action, args: [list.map((id) => BigInt(id))], account: wallet });
      const hash = await sendCards(write, contracts, action, list);
      setNote({ text: `${label}: sent, waiting for the block.` });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        setNote({ text: `${label}: the transaction reverted.`, tone: "alarm" });
      } else if (action === "claim") {
        setNote({ text: `Claimed ${imd4(claimedIn(receipt, contracts, wallet) ?? 0n)} IMD.`, tone: "jade" });
        setSelected(new Set());
      } else {
        setNote({ text: `${action === "stake" ? "Staked" : "Unstaked"} ${cardList(list)}.`, tone: "jade" });
        setSelected(new Set());
      }
    } catch (e) {
      setNote({ text: refusal(e), tone: "alarm" });
    } finally {
      setBusy(null);
      await queryClient.invalidateQueries({ queryKey: ["metamorph-wallet"] });
    }
  }

  const head = (
    <header className="ws-head">
      <div>
        <h1 className="serif">Your cards.</h1>
        <p className="mine-lede">{SENTENCE}</p>
        {contracts === null ? <span className="chip gold">Preview · the contracts are not live yet</span> : null}
      </div>
      {contracts && wallet ? (
        <div className="panel ws-figure" aria-live="polite">
          <span className="k">IMD earned, not claimed</span>
          <span className="v">
            <span className="serif num">{read ? imd4(read.earned) : "…"}</span>
            <span className="unit">IMD</span>
          </span>
        </div>
      ) : null}
    </header>
  );

  if (!contracts) {
    return <section className="wrap cards-page" aria-label="Your cards">{head}</section>;
  }

  if (!wallet) {
    // A wallet that was connected before comes back by itself within a few seconds of the page opening.
    return (
      <section className="wrap cards-page" aria-label="Your cards">
        {head}
        {status === "reconnecting" ? (
          <p className="ws-empty dim">Looking for your wallet…</p>
        ) : (
          <div className="panel ws-connect">
            <p>Connect a wallet to see your cards, stake them and claim IMD.</p>
            <button type="button" className="btn primary" onClick={() => openConnectModal?.()}>
              Connect wallet
            </button>
          </div>
        )}
      </section>
    );
  }

  const count = read?.cards.length ?? 0;
  return (
    <section className="wrap cards-page" aria-label="Your cards">
      {head}
      <div className="ws-bar">
        <span className="sel">
          {count ? (
            <>
              <span>{selected.size ? `${selected.size} of ${count} selected` : `${count} card${count === 1 ? "" : "s"} · tap to select`}</span>
              {selected.size < count ? (
                <button type="button" className="mine-alt" onClick={() => setSelected(new Set(read?.cards.map((c) => c.id)))}>
                  select all
                </button>
              ) : null}
              {selected.size ? (
                <button type="button" className="mine-alt" onClick={() => setSelected(new Set())}>
                  clear
                </button>
              ) : null}
            </>
          ) : null}
        </span>
        <button type="button" className="btn" disabled={!!busy || !ids.stake.length} onClick={() => void act("stake", ids.stake)}>
          {busy === "stake" ? "Staking…" : LABEL.stake}
        </button>
        <button type="button" className="btn" disabled={!!busy || !ids.unstake.length} onClick={() => void act("unstake", ids.unstake)}>
          {busy === "unstake" ? "Unstaking…" : LABEL.unstake}
        </button>
        <button type="button" className="btn primary" disabled={!!busy || toClaim === 0n} onClick={() => void act("claim", ids.claim)}>
          {busy === "claim" ? "Claiming…" : LABEL.claim}
        </button>
      </div>
      {note ? (
        <p className={`ws-note ${note.tone ?? ""}`} role="status">
          {note.text}
        </p>
      ) : null}
      {!busy && !ids.claim.length && unsettled > 0n ? (
        <p className="ws-note dim">Select your staked cards, then Claim IMD, to claim what they earned.</p>
      ) : null}

      {cards.error && !read ? (
        <p className="ws-empty alarm">Your cards could not be read: {errorText(cards.error)}</p>
      ) : !read ? (
        <p className="ws-empty dim">Reading your cards…</p>
      ) : count === 0 ? (
        <p className="ws-empty dim">
          No cards in this wallet yet. <Link href="/mine/">Mine one →</Link>
        </p>
      ) : (
        <ul className="tiles" aria-label="Your cards">
          {read?.cards.map((c) => (
            <CardTile
              key={c.id}
              card={c}
              contracts={contracts}
              selected={selected.has(c.id)}
              onToggle={() => toggle(c.id)}
              open={`/cards/view/?id=${c.id}`}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
