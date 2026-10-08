// End-to-end check of the site's live modules against a running chain: the local anvil fork by
// default (script/local/up.mjs), or any chain whose addresses file and funded key are given.
//
//   cd site && npx --yes tsx scripts/fork-e2e.ts [addresses.json] [rpc] [privateKey]
//
// It uses the same functions the browser uses: loadLive for the state, quoteExactIn and buildSwap
// for a buy and a sell through the Universal Router (Permit2 for the sell), then flush. Exits 1 on
// any failed assertion.

import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, formatEther, http, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { cocoonAbi, erc20Abi, hookAbi, permit2Abi } from "../lib/abi";
import type { Addresses } from "../lib/addresses";
import { loadLive } from "../lib/live";
import { buildSwap, MAX_UINT160, PERMIT2_EXPIRATION, quoteExactIn, withSlippage } from "../lib/swap";

const [, , addressesPath = "public/addresses.local.json", rpc = "http://127.0.0.1:8545", key] = process.argv;
// anvil's account #1; never a real key.
const ANVIL_1: Hex = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const account = privateKeyToAccount((key as Hex | undefined) ?? ANVIL_1);
const a = JSON.parse(readFileSync(addressesPath, "utf8")) as Addresses;
const chain = { ...foundry, id: a.chainId };
const pub = createPublicClient({ chain, transport: http(rpc) });
const wallet = createWalletClient({ chain, transport: http(rpc), account });

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const send = async (tx: { to: Address; data?: Hex; value?: bigint }) => {
  const hash = await wallet.sendTransaction({ ...tx, account, chain });
  return pub.waitForTransactionReceipt({ hash });
};
const write = async (args: Parameters<typeof wallet.writeContract>[0]) => {
  const hash = await wallet.writeContract(args);
  return pub.waitForTransactionReceipt({ hash });
};
// Deadlines from the chain's clock: a fork's time may be far from the wall clock.
const deadline = async () => (await pub.getBlock()).timestamp + 20n * 60n;

async function main(): Promise<number> {
  console.log(`chain ${a.chainId} · account ${account.address}`);

  // 1. The state loads and looks like an opened launch.
  const s0 = await loadLive(pub, a);
  console.log(`block ${s0.live.block} · buy tax ${s0.live.buyTaxBps} bps · floor ${s0.floor} ETH (fresh ${s0.live.fresh}) · wired ${s0.live.wired}`);
  check("state loads", s0.live.block > 0);
  check("pool is open", s0.live.openedAt > 0, `openedAt ${s0.live.openedAt}`);
  check("floor is fresh", s0.live.fresh, `${s0.floor} ETH`);
  check("vault is wired", s0.live.wired);

  // 2. Buy 0.1 ETH of PUPATE through the Universal Router; the hook takes the tax of the moment.
  const buyIn = parseEther("0.1");
  const quotedBuy = await quoteExactIn(pub, a, true, buyIn);
  check("buy quote is positive", quotedBuy > 0n, `${formatEther(quotedBuy)} PUPATE for 0.1 ETH`);
  const balBefore = await pub.readContract({ address: a.token, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  const taxBefore = await pub.readContract({ address: a.hook, abi: hookAbi, functionName: "totalTax" });
  const buy = buildSwap(a, true, buyIn, withSlippage(quotedBuy, 100), await deadline());
  const buyReceipt = await send(buy);
  check("buy transaction succeeded", buyReceipt.status === "success", `gas ${buyReceipt.gasUsed}`);
  const balAfter = await pub.readContract({ address: a.token, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  const taxAfter = await pub.readContract({ address: a.hook, abi: hookAbi, functionName: "totalTax" });
  const got = balAfter - balBefore;
  check("received at least the slippage floor", got >= withSlippage(quotedBuy, 100), `got ${formatEther(got)}, quoted ${formatEther(quotedBuy)}`);
  const expectedTax = (buyIn * BigInt(s0.live.buyTaxBps)) / 10_000n;
  check("hook took the buy tax", taxAfter - taxBefore === expectedTax, `${formatEther(taxAfter - taxBefore)} ETH at ${s0.live.buyTaxBps} bps`);

  // 3. Sell half of it back: Permit2 approvals, then the router.
  const sellIn = got / 2n;
  await write({ address: a.token, abi: erc20Abi, functionName: "approve", args: [a.permit2, 2n ** 256n - 1n], account, chain });
  await write({ address: a.permit2, abi: permit2Abi, functionName: "approve", args: [a.token, a.universalRouter, MAX_UINT160, Number(PERMIT2_EXPIRATION)], account, chain });
  const quotedSell = await quoteExactIn(pub, a, false, sellIn);
  check("sell quote is positive", quotedSell > 0n, `${formatEther(quotedSell)} ETH for ${formatEther(sellIn)} PUPATE`);
  const ethBefore = await pub.getBalance({ address: account.address });
  const sell = buildSwap(a, false, sellIn, withSlippage(quotedSell, 100), await deadline());
  const sellReceipt = await send(sell);
  check("sell transaction succeeded", sellReceipt.status === "success", `gas ${sellReceipt.gasUsed}`);
  const ethAfter = await pub.getBalance({ address: account.address });
  const gasPaid = sellReceipt.gasUsed * sellReceipt.effectiveGasPrice;
  const ethGot = ethAfter + gasPaid - ethBefore;
  check("received at least the slippage floor in ETH", ethGot >= withSlippage(quotedSell, 100), `got ${formatEther(ethGot)}, quoted ${formatEther(quotedSell)}`);
  const taxAfterSell = await pub.readContract({ address: a.hook, abi: hookAbi, functionName: "totalTax" });
  check("hook took a sell tax", taxAfterSell > taxAfter, `${formatEther(taxAfterSell - taxAfter)} ETH`);

  // 4. Flush: the collected tax reaches the vault and is split.
  const potBefore = await pub.readContract({ address: a.cocoon, abi: cocoonAbi, functionName: "seatPot" });
  const flushReceipt = await write({ address: a.hook, abi: hookAbi, functionName: "flush", account, chain });
  check("flush succeeded", flushReceipt.status === "success");
  const s1 = await loadLive(pub, a);
  check("seat pot grew", s1.seatPot > Number(formatEther(potBefore)), `${s1.seatPot} ETH`);
  check("hook is empty after flush", s1.hookWaiting === 0, `${s1.hookWaiting}`);
  check("tax collected matches the hook", Math.abs(s1.taxCollected - Number(formatEther(taxAfterSell))) < 1e-9, `${s1.taxCollected} ETH`);
  check("a caller is credited with the flush", s1.callers.some((c) => c.flush > 0), JSON.stringify(s1.callers));
  check("burned so far reads from supply", s1.burned >= 0, `${s1.burned} PUPATE`);

  console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
  return failures ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
