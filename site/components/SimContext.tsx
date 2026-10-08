"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState, type ReactNode } from "react";
import { formatEther, parseEther, parseUnits, type Hex } from "viem";
import { useAccount, usePublicClient, useSendTransaction, useSwitchChain, useWriteContract } from "wagmi";
import { cocoonAbi, erc20Abi, hookAbi, permit2Abi } from "@/lib/abi";
import { loadAddresses, TARGET_CHAIN_ID, type Addresses } from "@/lib/addresses";
import { loadLive } from "@/lib/live";
import { eth, pad4, preset, reduce, type Action, type SimState } from "@/lib/sim";
import { buildSwap, MAX_UINT160, PERMIT2_EXPIRATION, quoteExactIn, withSlippage } from "@/lib/swap";

// One provider, two sources. Without deployed contracts for the target chain the page runs the
// simulation (the design preview). With them it reads the chain every block or so and turns the same
// actions into real transactions. The components see one state shape either way.

const StateContext = createContext<SimState | null>(null);
const DispatchContext = createContext<((a: Action) => void) | null>(null);
const AddressesContext = createContext<Addresses | null>(null);

export const SLIPPAGE_BPS = 100;
const UNLIMITED = 2n ** 256n - 1n;

export function SimProvider({ children }: { children: ReactNode }) {
  // The simulation reducer also keeps the UI-only state (wallet, direction, toast, log) in live mode.
  const [ui, dispatchUi] = useReducer(reduce, "steady", preset);
  const [addresses, setAddresses] = useState<Addresses | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    loadAddresses().then((a) => on && setAddresses(a));
    return () => {
      on = false;
    };
  }, []);

  const { address, isConnected, chainId: walletChain } = useAccount();
  const client = usePublicClient({ chainId: TARGET_CHAIN_ID });
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();
  const queryClient = useQueryClient();

  const live = useQuery({
    queryKey: ["live", addresses?.chainId, addresses?.cocoon],
    queryFn: () => loadLive(client!, addresses!),
    enabled: !!addresses && !!client,
    refetchInterval: 12_000,
    staleTime: 6_000,
    retry: 1,
  });

  // The wallet is real in both modes.
  useEffect(() => {
    dispatchUi({ type: "wallet", address: isConnected && address ? address : null });
  }, [address, isConnected]);

  // The preview's five-block burn spacing, one block every 1.2 seconds; live mode counts real blocks.
  useEffect(() => {
    if (addresses || ui.burnCooldown === 0) return;
    const t = setTimeout(() => dispatchUi({ type: "burnTick" }), 1200);
    return () => clearTimeout(t);
  }, [ui.burnCooldown, addresses]);

  useEffect(() => {
    if (!ui.toast) return;
    const t = setTimeout(() => dispatchUi({ type: "dismissToast" }), 4200);
    return () => clearTimeout(t);
  }, [ui.toast]);

  const state: SimState = useMemo(() => {
    if (!addresses || !live.data) return ui;
    const snap = live.data;
    return { ...ui, ...snap, live: { ...snap.live, pending } };
  }, [ui, addresses, live.data, pending]);

  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: ["live"] }), [queryClient]);
  const note = useCallback((text: string) => dispatchUi({ type: "note", text }), []);

  /// Sends one transaction with the wallet on the target chain and reports its life in the log.
  const run = useCallback(
    async (label: string, send: () => Promise<Hex>) => {
      if (!client || pending) return;
      try {
        if (walletChain !== TARGET_CHAIN_ID) await switchChainAsync({ chainId: TARGET_CHAIN_ID });
        setPending(label);
        const hash = await send();
        note(`${label}: sent ${hash.slice(0, 10)}…, waiting for the block.`);
        const receipt = await client.waitForTransactionReceipt({ hash });
        note(receipt.status === "success" ? `${label}: confirmed in block ${receipt.blockNumber}.` : `${label}: the transaction reverted.`);
      } catch (e) {
        note(`${label}: ${String((e as Error)?.message ?? e).split("\n")[0].slice(0, 140)}`);
      } finally {
        setPending(null);
        await refresh();
      }
    },
    [client, pending, walletChain, switchChainAsync, note, refresh],
  );

  const swap = useCallback(
    async (a: Addresses, buying: boolean, amount: number, raw?: string) => {
      if (!client || !address) return;
      let amountIn: bigint;
      try {
        amountIn = buying ? parseEther(raw ?? String(amount)) : parseUnits(raw ?? String(amount), 18);
      } catch {
        note("That amount does not parse.");
        return;
      }
      if (amountIn <= 0n) return;
      await run(buying ? "Buy PUPATE" : "Sell PUPATE", async () => {
        if (!buying) {
          // Selling pays PUPATE through Permit2: the token allows Permit2 once, Permit2 allows the router.
          const [allowance, [p2Amount, p2Expiry]] = await Promise.all([
            client.readContract({ address: a.token, abi: erc20Abi, functionName: "allowance", args: [address, a.permit2] }),
            client.readContract({ address: a.permit2, abi: permit2Abi, functionName: "allowance", args: [address, a.token, a.universalRouter] }),
          ]);
          if (allowance < amountIn) {
            note("Approving PUPATE for Permit2 (once).");
            const h = await writeContractAsync({ address: a.token, abi: erc20Abi, functionName: "approve", args: [a.permit2, UNLIMITED], chainId: TARGET_CHAIN_ID });
            await client.waitForTransactionReceipt({ hash: h });
          }
          if (p2Amount < amountIn || Number(p2Expiry) <= Math.floor(Date.now() / 1000)) {
            note("Allowing the router through Permit2 (once).");
            const h = await writeContractAsync({
              address: a.permit2,
              abi: permit2Abi,
              functionName: "approve",
              args: [a.token, a.universalRouter, MAX_UINT160, Number(PERMIT2_EXPIRATION)],
              chainId: TARGET_CHAIN_ID,
            });
            await client.waitForTransactionReceipt({ hash: h });
          }
        }
        const quoted = await quoteExactIn(client, a, buying, amountIn);
        const call = buildSwap(a, buying, amountIn, withSlippage(quoted, SLIPPAGE_BPS));
        note(
          buying
            ? `Buying with ${eth(Number(formatEther(amountIn)), 4)}; at least ${Math.floor(Number(formatEther(quoted)) * (1 - SLIPPAGE_BPS / 10_000)).toLocaleString("en-US")} PUPATE.`
            : `Selling ${Number(formatEther(amountIn)).toLocaleString("en-US")} PUPATE for at least ${eth(Number(formatEther(withSlippage(quoted, SLIPPAGE_BPS))), 5)}.`,
        );
        return sendTransactionAsync({ to: call.to, data: call.data, value: call.value, chainId: TARGET_CHAIN_ID });
      });
    },
    [client, address, run, note, writeContractAsync, sendTransactionAsync],
  );

  const takeAuction = useCallback(
    async (a: Addresses, s: SimState) => {
      if (!client || !address || !s.live) return;
      if (s.live.harvestToken) {
        const token = s.live.harvestToken;
        await run("Take the lot", async () => {
          const price = await client.readContract({ address: a.cocoon, abi: cocoonAbi, functionName: "auctionPrice", args: [token] });
          return writeContractAsync({ address: a.cocoon, abi: cocoonAbi, functionName: "takeAuction", args: [token], value: price, chainId: TARGET_CHAIN_ID });
        });
        return;
      }
      if (s.live.imdAuction) {
        await run("Take the IMD auction", async () => {
          const demand = await client.readContract({ address: a.cocoon, abi: cocoonAbi, functionName: "imdDemand" });
          const allowance = await client.readContract({ address: a.imd, abi: erc20Abi, functionName: "allowance", args: [address, a.cocoon] });
          if (allowance < demand) {
            note("Approving IMD for the vault.");
            const h = await writeContractAsync({ address: a.imd, abi: erc20Abi, functionName: "approve", args: [a.cocoon, demand], chainId: TARGET_CHAIN_ID });
            await client.waitForTransactionReceipt({ hash: h });
          }
          return writeContractAsync({ address: a.cocoon, abi: cocoonAbi, functionName: "takeImdAuction", chainId: TARGET_CHAIN_ID });
        });
      }
    },
    [client, address, run, note, writeContractAsync],
  );

  const dispatch = useCallback(
    (a: Action) => {
      if (!addresses) {
        dispatchUi(a);
        return;
      }
      const A = addresses;
      switch (a.type) {
        case "wallet":
        case "direction":
        case "dismissToast":
        case "note":
          dispatchUi(a);
          return;
        case "preset":
        case "advance":
        case "burnTick":
          return;
        case "flush":
          void run("Flush", () => writeContractAsync({ address: A.hook, abi: hookAbi, functionName: "flush", chainId: TARGET_CHAIN_ID }));
          return;
        case "burn":
          void run("Burn", () => writeContractAsync({ address: A.cocoon, abi: cocoonAbi, functionName: "burn", chainId: TARGET_CHAIN_ID }));
          return;
        case "startAuction":
          void run("Start the IMD auction", () =>
            writeContractAsync({ address: A.cocoon, abi: cocoonAbi, functionName: "startImdAuction", chainId: TARGET_CHAIN_ID }),
          );
          return;
        case "takeAuction":
          void takeAuction(A, state);
          return;
        case "buySeat":
          note("Buying a seat needs a Seaport listing at or under the tolerance. The keeper finds one; any agent can, with skill.md.");
          return;
        case "sellSeat":
          note(`Seat ${pad4(a.id)} is listed by the vault on Seaport. Buy it on OpenSea; the sale lands in the burn pot.`);
          return;
        case "swap":
          void swap(A, state.buying, a.amount, a.raw);
          return;
      }
    },
    [addresses, state, run, swap, takeAuction, note, writeContractAsync],
  );

  return (
    <AddressesContext.Provider value={addresses}>
      <StateContext.Provider value={state}>
        <DispatchContext.Provider value={dispatch}>{children}</DispatchContext.Provider>
      </StateContext.Provider>
    </AddressesContext.Provider>
  );
}

export function useSim(): SimState {
  const s = useContext(StateContext);
  if (!s) throw new Error("useSim outside SimProvider");
  return s;
}

export function useDispatch(): (a: Action) => void {
  const d = useContext(DispatchContext);
  if (!d) throw new Error("useDispatch outside SimProvider");
  return d;
}

/// The deployed contracts, or null in preview mode.
export function useAddresses(): Addresses | null {
  return useContext(AddressesContext);
}

/// What the pool would give right now for an amount typed into the swap panel. Live mode only.
export function useQuote(amountText: string, buying: boolean): { out: bigint | null; loading: boolean } {
  const a = useAddresses();
  const client = usePublicClient({ chainId: TARGET_CHAIN_ID });
  let amountIn = 0n;
  try {
    amountIn = buying ? parseEther(amountText) : parseUnits(amountText, 18);
  } catch {
    amountIn = 0n;
  }
  const q = useQuery({
    queryKey: ["quote", a?.cocoon, buying, amountIn.toString()],
    queryFn: () => quoteExactIn(client!, a!, buying, amountIn),
    enabled: !!a && !!client && amountIn > 0n,
    refetchInterval: 15_000,
    staleTime: 5_000,
    retry: 0,
  });
  return { out: amountIn > 0n ? (q.data ?? null) : 0n, loading: q.isFetching && q.data === undefined };
}
