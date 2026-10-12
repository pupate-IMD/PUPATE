#!/usr/bin/env node
// The developer's side of Pupate on mainnet: where the developer's share and the vested allocation
// go, and taking what has accrued. Each command reads the chain first and refuses what would not
// work. The key comes from .env (KEEPER_PRIVATE_KEY, the launch wallet); nothing secret is printed.
//
//   node script/mainnet/developer.mjs status                      balances, who receives what
//   node script/mainnet/developer.mjs set-developer <address>     Cocoon.setDeveloper: future claims pay <address>
//   node script/mainnet/developer.mjs set-beneficiary <address>   PupateVesting.setBeneficiary: releases pay <address>
//   node script/mainnet/developer.mjs claim                       Cocoon.claimDeveloper: pay what has accrued
//   node script/mainnet/developer.mjs release                     PupateVesting.release: pay what has vested
//   node script/mainnet/developer.mjs move-eth <address> [eth]    send this wallet's ETH to <address>, all but a
//                                                                 gas reserve (KEEP_ETH, default 0.01) unless [eth] says how much
//
// setDeveloper may only be called by the current developer, setBeneficiary only by the current
// beneficiary; claim and release may be called by anyone and always pay the recorded address.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, castLocal, fmtEth, readDotEnv, run } from '../local/common.mjs';

const dotenv = readDotEnv();
const env = (k) => process.env[k] || dotenv[k] || '';
const RPC = env('MAINNET_RPC_URL');
const KEY = env('KEEPER_PRIVATE_KEY');
if (!RPC) fail('MAINNET_RPC_URL is not set');
if (!/^0x[0-9a-fA-F]{64}$/.test(KEY)) fail('KEEPER_PRIVATE_KEY is not set or not a 0x-prefixed 32-byte key');

const ADDRESSES_FILE = join(ROOT, 'keeper', 'addresses.mainnet.json');
if (!existsSync(ADDRESSES_FILE)) fail(`${ADDRESSES_FILE} is missing: run script/mainnet/launch.mjs finish first`);
const A = JSON.parse(readFileSync(ADDRESSES_FILE, 'utf8'));
if (A.chainId !== 1) fail(`${ADDRESSES_FILE} is for chain ${A.chainId}`);

const cmd = process.argv[2] || 'status';
const arg = process.argv[3];
const commands = { status, 'set-developer': setDeveloper, 'set-beneficiary': setBeneficiary, claim, release, 'move-eth': moveEth };
if (!commands[cmd]) fail(`unknown command ${cmd}; one of: ${Object.keys(commands).join(', ')}`);
Promise.resolve()
  .then(() => commands[cmd]())
  .catch((e) => {
    console.error(`\n${cmd} failed: ${scrub(e.message || String(e))}`);
    process.exitCode = 1;
  });

async function status() {
  const me = wallet();
  const developer = call(A.cocoon, 'developer()(address)');
  const beneficiary = call(A.vesting, 'beneficiary()(address)');
  const accrued = BigInt(call(A.cocoon, 'developerBalance()(uint256)'));
  const releasable = BigInt(call(A.vesting, 'releasable()(uint256)'));
  const vested = BigInt(call(A.vesting, 'vested()(uint256)'));
  const held = BigInt(call(A.token, 'balanceOf(address)(uint256)', A.vesting));
  console.log(`this key           ${me}`);
  console.log(`developer          ${developer}${same(developer, me) ? '  (this key)' : ''}`);
  console.log(`  accrued, claimable by anyone, paid to the developer: ${fmtEth(accrued)}`);
  console.log(`vesting beneficiary ${beneficiary}${same(beneficiary, me) ? '  (this key)' : ''}`);
  console.log(`  vested so far ${fmtPupate(vested)}, releasable now ${fmtPupate(releasable)}, still in the contract ${fmtPupate(held)}`);
  console.log(`\nOne call each moves the roles to another wallet, from this key only while it still holds them:`);
  console.log(`  node script/mainnet/developer.mjs set-developer <address>`);
  console.log(`  node script/mainnet/developer.mjs set-beneficiary <address>`);
}

async function setDeveloper() {
  const to = target(arg);
  const me = wallet();
  const developer = call(A.cocoon, 'developer()(address)');
  if (!same(developer, me)) throw new Error(`the developer is ${developer}, not this key; only the developer may change it`);
  if (same(developer, to)) {
    console.log(`already done: the developer is ${to}`);
    return;
  }
  console.log(`Cocoon.setDeveloper(${to}): every future claim pays this address`);
  const tx = send(A.cocoon, 'setDeveloper(address)', to);
  const now = call(A.cocoon, 'developer()(address)');
  if (!same(now, to)) throw new Error(`the developer reads ${now} after the transaction`);
  console.log(`developer is now ${now}\n${link(tx)}`);
}

async function setBeneficiary() {
  const to = target(arg);
  const me = wallet();
  const beneficiary = call(A.vesting, 'beneficiary()(address)');
  if (!same(beneficiary, me)) throw new Error(`the beneficiary is ${beneficiary}, not this key; only the beneficiary may change it`);
  if (same(beneficiary, to)) {
    console.log(`already done: the beneficiary is ${to}`);
    return;
  }
  console.log(`PupateVesting.setBeneficiary(${to}): every release pays this address`);
  const tx = send(A.vesting, 'setBeneficiary(address)', to);
  const now = call(A.vesting, 'beneficiary()(address)');
  if (!same(now, to)) throw new Error(`the beneficiary reads ${now} after the transaction`);
  console.log(`beneficiary is now ${now}\n${link(tx)}`);
}

async function claim() {
  const developer = call(A.cocoon, 'developer()(address)');
  const accrued = BigInt(call(A.cocoon, 'developerBalance()(uint256)'));
  if (accrued === 0n) {
    console.log('nothing has accrued');
    return;
  }
  console.log(`Cocoon.claimDeveloper(): ${fmtEth(accrued)} to the developer ${developer}`);
  const tx = send(A.cocoon, 'claimDeveloper()');
  console.log(`paid\n${link(tx)}`);
}

async function release() {
  const beneficiary = call(A.vesting, 'beneficiary()(address)');
  const releasable = BigInt(call(A.vesting, 'releasable()(uint256)'));
  if (releasable === 0n) {
    console.log('nothing has vested since the last release');
    return;
  }
  console.log(`PupateVesting.release(): ${fmtPupate(releasable)} to the beneficiary ${beneficiary}`);
  const tx = send(A.vesting, 'release()');
  console.log(`released\n${link(tx)}`);
}

/** Plain ETH from this wallet to a wallet of the developer's choosing: what claims paid here before the
 *  developer moved, less what the keeper needs for gas. */
async function moveEth() {
  const to = target(arg);
  const me = wallet();
  const balance = BigInt(run('cast', ['balance', me, '--rpc-url', RPC]).stdout.trim());
  const keep = BigInt(Math.round(Number(env('KEEP_ETH') || 0.01) * 1e18));
  const asked = process.argv[4];
  let amount;
  if (asked !== undefined) {
    if (!/^d+(.d+)?$/.test(asked)) throw new Error(`the amount must be a number of ETH, not ${asked}`);
    amount = BigInt(Math.round(Number(asked) * 1e18));
    if (amount + keep > balance) throw new Error(`${fmtEth(amount)} would leave less than the ${fmtEth(keep)} the keeper needs for gas (balance ${fmtEth(balance)})`);
  } else {
    if (balance <= keep) throw new Error(`the balance ${fmtEth(balance)} is not above the ${fmtEth(keep)} kept for gas; nothing to move`);
    amount = balance - keep;
  }
  console.log(`${fmtEth(amount)} from ${me} to ${to}, keeping ${fmtEth(keep)} for the keeper's gas`);
  const r = run('cast', ['send', to, '--value', amount.toString(), '--rpc-url', RPC, '--private-key', KEY, '--json'], { quiet: true });
  if (r.status !== 0) throw new Error(`the transfer failed: ${scrub(r.stdout + r.stderr).slice(0, 600)}`);
  const receipt = JSON.parse(r.stdout);
  console.log(`sent
${link(receipt.transactionHash)}`);
}

// ------------------------------------------------------------------ helpers

/** A checksummed, code-free address: the roles pay with a plain transfer, which a contract may refuse. */
function target(value) {
  if (!value || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error('give the address to move the role to');
  const checksummed = castLocal('to-check-sum-address', value);
  if (checksummed !== value && value !== value.toLowerCase()) throw new Error(`${value} is not the checksummed form of ${checksummed}; check the address character by character`);
  if (/^0x0{40}$/.test(value)) throw new Error('the zero address is refused');
  const code = run('cast', ['code', checksummed, '--rpc-url', RPC]).stdout.trim();
  if (code !== '0x') throw new Error(`${checksummed} is a contract; the roles are paid with a plain ETH or token transfer, so use a wallet you hold the keys to`);
  return checksummed;
}

function wallet() {
  return castLocal('wallet', 'address', '--private-key', KEY);
}

function call(to, sig, ...args) {
  const out = run('cast', ['call', to, sig, ...args.map(String), '--rpc-url', RPC]).stdout.trim();
  return out.split(/\r?\n/)[0].replace(/\s+\[[^\]]*\]\s*$/, '').trim();
}

/** Sends one transaction and waits for its receipt; throws if it reverted or the gas price is high. */
function send(to, sig, ...args) {
  const baseFee = BigInt(run('cast', ['base-fee', '--rpc-url', RPC]).stdout.trim().split(/\s/)[0]);
  const cap = BigInt(Math.round(Number(env('MAX_BASE_FEE_GWEI') || 1) * 1e9));
  if (baseFee > cap) throw new Error(`base fee ${Number(baseFee) / 1e9} gwei is above the ${Number(cap) / 1e9} gwei cap; wait, or raise MAX_BASE_FEE_GWEI knowingly`);
  const r = run('cast', ['send', to, sig, ...args.map(String), '--rpc-url', RPC, '--private-key', KEY, '--json'], { quiet: true });
  if (r.status !== 0) throw new Error(`the transaction failed: ${scrub(r.stdout + r.stderr).slice(0, 600)}`);
  const receipt = JSON.parse(r.stdout);
  if (receipt.status !== '0x1' && receipt.status !== 1 && receipt.status !== '1') throw new Error(`the transaction reverted: ${receipt.transactionHash}`);
  return receipt.transactionHash;
}

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const link = (tx) => `https://etherscan.io/tx/${tx}`;
const fmtPupate = (wei) => `${(Number(wei) / 1e18).toLocaleString('en-US', { maximumFractionDigits: 2 })} PUPATE`;

function scrub(text) {
  return String(text).split(RPC).join('<rpc>').split(KEY).join('<key>');
}

function fail(msg) {
  console.error(msg);
  process.exit(2);
}
