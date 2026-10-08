// Real trades in the launch pool through Uniswap's Universal Router (v4 commands). Third-party
// interfaces tend not to route pools whose hook returns deltas, so the site carries its own path.
// Pure functions: the calldata is built here and sent by the caller, so it can be tested against a
// fork without a browser.

import { concatHex, encodeAbiParameters, encodeFunctionData, zeroAddress, type Address, type Hex, type PublicClient } from "viem";
import type { Addresses } from "./addresses";
import { quoterAbi, universalRouterAbi } from "./abi";

const COMMAND_V4_SWAP: Hex = "0x10";
const ACTION_SWAP_EXACT_IN_SINGLE: Hex = "0x06";
const ACTION_SETTLE_ALL: Hex = "0x0c";
const ACTION_TAKE_ALL: Hex = "0x0f";

const poolKeyType = {
  type: "tuple",
  components: [
    { name: "currency0", type: "address" },
    { name: "currency1", type: "address" },
    { name: "fee", type: "uint24" },
    { name: "tickSpacing", type: "int24" },
    { name: "hooks", type: "address" },
  ],
} as const;

export interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

/// The launch pool's key: native ETH is currency0 (address zero sorts first), PUPATE is currency1.
export function launchPoolKey(a: Addresses): PoolKey {
  return { currency0: zeroAddress, currency1: a.token, fee: a.poolKey.fee, tickSpacing: a.poolKey.tickSpacing, hooks: a.hook };
}

/// What the pool would give for `amountIn`, tax and LP fee included: the quoter runs the hook.
export async function quoteExactIn(client: PublicClient, a: Addresses, buying: boolean, amountIn: bigint): Promise<bigint> {
  if (amountIn === 0n) return 0n;
  const { result } = await client.simulateContract({
    address: a.quoter,
    abi: quoterAbi,
    functionName: "quoteExactInputSingle",
    args: [{ poolKey: launchPoolKey(a), zeroForOne: buying, exactAmount: amountIn, hookData: "0x" }],
  });
  return result[0];
}

export interface SwapCall {
  to: Address;
  data: Hex;
  value: bigint;
}

/// Universal Router calldata for one exact-in swap in the launch pool. Buying pays ETH (sent as
/// value) and takes PUPATE; selling pays PUPATE through Permit2 and takes ETH.
export function buildSwap(
  a: Addresses,
  buying: boolean,
  amountIn: bigint,
  minOut: bigint,
  deadline: bigint = BigInt(Math.floor(Date.now() / 1000) + 20 * 60),
): SwapCall {
  const key = launchPoolKey(a);
  const currencyIn = buying ? key.currency0 : key.currency1;
  const currencyOut = buying ? key.currency1 : key.currency0;
  const actions = concatHex([ACTION_SWAP_EXACT_IN_SINGLE, ACTION_SETTLE_ALL, ACTION_TAKE_ALL]);
  const params: Hex[] = [
    encodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { name: "poolKey", ...poolKeyType },
            { name: "zeroForOne", type: "bool" },
            { name: "amountIn", type: "uint128" },
            { name: "amountOutMinimum", type: "uint128" },
            { name: "hookData", type: "bytes" },
          ],
        },
      ],
      [{ poolKey: key, zeroForOne: buying, amountIn, amountOutMinimum: minOut, hookData: "0x" }],
    ),
    encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [currencyIn, amountIn]),
    encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [currencyOut, minOut]),
  ];
  const input = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [actions, params]);
  const data = encodeFunctionData({ abi: universalRouterAbi, functionName: "execute", args: [COMMAND_V4_SWAP, [input], deadline] });
  return { to: a.universalRouter, data, value: buying ? amountIn : 0n };
}

/// `minOut` from a quote and a slippage in basis points.
export const withSlippage = (quoted: bigint, bps: number) => (quoted * BigInt(10_000 - bps)) / 10_000n;

/// Far enough in the future for Permit2's uint48 expiration.
export const PERMIT2_EXPIRATION = 2n ** 48n - 1n;
export const MAX_UINT160 = 2n ** 160n - 1n;
