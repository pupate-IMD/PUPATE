// Clients, the chain object, revert decoding, and the one transaction path every action uses:
// simulate with eth_call first, estimate gas, respect the gas price cap, send with a sequential
// nonce, wait for the receipt. In dry-run mode it stops after the simulation.
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  http,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry, mainnet, sepolia } from 'viem/chains';
import { fmtGwei, log, warn } from './log.mjs';

/// Multicall3 lives at the same address on mainnet, Sepolia and (through the fork) anvil.
export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';

export function chainFor(chainId) {
  const base = chainId === 1 ? mainnet : chainId === 11155111 ? sepolia : chainId === 31337 ? foundry : { ...mainnet, name: `chain ${chainId}` };
  return { ...base, id: chainId, contracts: { ...(base.contracts || {}), multicall3: { address: MULTICALL3 } } };
}

export function createClients(cfg) {
  const chain = chainFor(cfg.chainId);
  const transport = http(cfg.rpc, { timeout: 30_000, retryCount: 2 });
  const pub = createPublicClient({ chain, transport, batch: { multicall: false } });
  const account = cfg.keeperPrivateKey ? privateKeyToAccount(cfg.keeperPrivateKey) : null;
  const wallet = account ? createWalletClient({ account, chain, transport }) : null;
  return { chain, pub, wallet, account };
}

/** The decoded name of a custom error (with args), or the best short message viem has. */
export function revertReason(e) {
  if (!(e instanceof BaseError)) return e?.message || String(e);
  const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
  if (r) {
    if (r.data?.errorName) {
      const args = (r.data.args || []).map((v) => (typeof v === 'bigint' ? v.toString() : String(v)));
      return args.length ? `${r.data.errorName}(${args.join(', ')})` : r.data.errorName;
    }
    if (r.signature) return `unknown error ${r.signature}`;
    if (r.reason) return r.reason;
    return r.shortMessage;
  }
  const first = e.shortMessage || e.message || String(e);
  return first.split('\n')[0];
}

/**
 * @param {object} o
 * @param {import('viem').PublicClient} o.pub
 * @param {import('viem').WalletClient|null} o.wallet
 * @param {boolean} o.dryRun
 * @param {bigint} o.gasCapWei maxFeePerGas above which nothing is sent this tick
 * @param {number} o.txTimeoutSec how long to wait for a receipt
 */
export function createTx({ pub, wallet, account, dryRun, gasCapWei, txTimeoutSec }) {
  let nonce = null;
  let waitingLogged = false;

  async function syncNonce() {
    nonce = account ? await pub.getTransactionCount({ address: account.address, blockTag: 'pending' }) : null;
    waitingLogged = false;
  }

  /** eth_call with the keeper as sender. Returns { ok, request, result } or { ok: false, reason }. */
  async function simulate(call) {
    try {
      const { request, result } = await pub.simulateContract({ ...call, account: account ?? call.account ?? undefined });
      return { ok: true, request, result };
    } catch (e) {
      return { ok: false, reason: revertReason(e), error: e };
    }
  }

  /** The fee the next transaction would pay, and whether the cap allows sending now. */
  async function fees() {
    const [block, est] = await Promise.all([pub.getBlock({ blockTag: 'latest' }), pub.estimateFeesPerGas()]);
    const base = block.baseFeePerGas ?? 0n;
    const tip = est.maxPriorityFeePerGas ?? 0n;
    const need = base + tip;
    const maxFeePerGas = est.maxFeePerGas > gasCapWei ? gasCapWei : est.maxFeePerGas;
    return { base, tip, need, maxFeePerGas, maxPriorityFeePerGas: tip, allowed: need <= gasCapWei };
  }

  /**
   * Simulate, then send and wait. `label` is what the log line says.
   * @returns {{status: 'sent'|'dry'|'reverted'|'waiting'|'failed'|'nokey', hash?, gasUsed?, receipt?, result?, reason?}}
   */
  async function run(label, call) {
    const sim = await simulate(call);
    if (!sim.ok) {
      log(`skip ${label}: ${sim.reason}`);
      return { status: 'reverted', reason: sim.reason };
    }
    let gas;
    try {
      gas = await pub.estimateContractGas({ ...call, account: account ?? undefined });
      gas = (gas * 125n) / 100n;
    } catch (e) {
      log(`skip ${label}: gas estimate failed: ${revertReason(e)}`);
      return { status: 'failed', reason: revertReason(e) };
    }
    if (dryRun) {
      log(`dry run: would send ${label} (gas estimate ${gas})`);
      return { status: 'dry', result: sim.result, gas };
    }
    if (!wallet || !account) {
      log(`skip ${label}: no KEEPER_PRIVATE_KEY (simulation passed; set DRY_RUN=1 to silence this)`);
      return { status: 'nokey', result: sim.result };
    }
    const f = await fees();
    if (!f.allowed) {
      if (!waitingLogged) {
        log(`wait ${label}: base fee ${fmtGwei(f.base)} + tip ${fmtGwei(f.tip)} is above the cap ${fmtGwei(gasCapWei)}`);
        waitingLogged = true;
      }
      return { status: 'waiting', reason: 'gas price above cap' };
    }
    if (nonce === null) await syncNonce();
    let hash;
    try {
      hash = await wallet.writeContract({
        ...sim.request,
        account,
        nonce,
        gas,
        maxFeePerGas: f.maxFeePerGas,
        maxPriorityFeePerGas: f.maxPriorityFeePerGas,
      });
    } catch (e) {
      const reason = revertReason(e);
      warn(`${label}: send failed: ${reason}`);
      await syncNonce(); // a nonce clash or a dropped transaction: start the count again
      return { status: 'failed', reason };
    }
    nonce += 1;
    let receipt;
    try {
      receipt = await pub.waitForTransactionReceipt({ hash, timeout: txTimeoutSec * 1000, pollingInterval: 1000 });
    } catch (e) {
      warn(`${label}: no receipt for ${hash} after ${txTimeoutSec}s (${revertReason(e)})`);
      await syncNonce();
      return { status: 'failed', hash, reason: 'receipt timeout' };
    }
    const ok = receipt.status === 'success';
    log(`${ok ? 'sent' : 'REVERTED'} ${label} -> ${hash} (gas ${receipt.gasUsed}, block ${receipt.blockNumber})`);
    return { status: ok ? 'sent' : 'failed', hash, gasUsed: receipt.gasUsed, receipt, result: sim.result };
  }

  return { syncNonce, simulate, fees, run };
}
