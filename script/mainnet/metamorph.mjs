#!/usr/bin/env node
// Metamorph MD on mainnet, step by step: the "Metamorph MD" section of README.md in this directory as a
// program, in the manner of launch.mjs. Each step reads the chain first, refuses what the runbook says to
// refuse, runs the forge script without --broadcast and shows what it would send, asks before every
// broadcast, checks the result on chain and records the addresses, so an interrupted step is simply run
// again. Nothing secret is printed.
//
//   node script/mainnet/metamorph.mjs status      chain, deployer, base fee, what is recorded, the live checks
//   node script/mainnet/metamorph.mjs art         step 1: MetamorphChrysalis, MetamorphButterfly, MetamorphArt   (gas only)
//   node script/mainnet/metamorph.mjs rehearsal   between 1 and 2: MetamorphRehearsal wearing the router, eight
//                                                 cards to look at on OpenSea and in a wallet                 (gas only)
//   node script/mainnet/metamorph.mjs token       step 2: MetamorphMD at 20 bits, ART being the router        (gas only)
//   node script/mainnet/metamorph.mjs record      steps 3 and 4: site/lib/addresses.ts, then the git, keeper
//                                                 and site lines to run by hand                               (nothing)
//
// Flags: --dry-run (simulate and print, send nothing, ask nothing), --yes (ask nothing, send), --again (deploy
// a recorded step over again), --rpc <url> (instead of MAINNET_RPC_URL; chain 31337 is the local fork of
// script/local/up.mjs), --key <hex> (instead of KEEPER_PRIVATE_KEY), --book <path> (the address book, read and
// written: keeper/addresses.mainnet.json on mainnet, site/public/addresses.local.json on the fork),
// --site <path> (record: the file written instead of site/lib/addresses.ts).
//
// Environment, from .env or the environment: MAINNET_RPC_URL, KEEPER_PRIVATE_KEY (the deployer, which is the
// keeper's key), optional ETHERSCAN_API_KEY (--verify on each mainnet broadcast), MAX_BASE_FEE_GWEI (default
// 2: nothing is broadcast above it). Progress in keeper/.launch/metamorph.json (ignored by git;
// metamorph.local.json on the fork): the addresses as deployed, the rehearsal, what was abandoned.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { ROOT, castLocal, fmtEth, fmtGwei, readDotEnv, run } from '../local/common.mjs';

const MIN_BITS = 20;
/** What the code alone fixes (the runbook, step 1): the figures' code sizes and the sample card's token URI lengths. */
const EXPECT = { chrysalisCode: 7655, butterflyCode: 8191, chrysalisUri: 21045, butterflyUri: 20285 };
const DATA_URI = 'data:application/json;base64,';
const VIEW_URI = 'tokenURI((uint256,uint256,uint16,uint16,uint8,bool,uint16,address,uint40,uint256))';
/**
 * The deploy script's sample card as the runbook's `cast call` writes it: token 1, seat 1376's holotype in
 * round 0, plain, epoch 1, mined for 50,000 PUPATE, at time 0. Neither the miner nor the time reaches the
 * picture, so the length is the dry run's.
 */
const sampleView = (stage, miner) => `(1,1376,0,1,${stage},false,1,${miner},0,50000000000000000000000)`;
const SCRIPT = {
  art: 'script/DeployMetamorphArt.s.sol:DeployMetamorphArt',
  rehearsal: 'script/RehearseMetamorphArt.s.sol:RehearseMetamorphArt',
  token: 'script/DeployMetamorph.s.sol:DeployMetamorph',
};
/** Where each contract's source is, for `forge verify-contract` when no Etherscan key verified it at the broadcast. */
const SOURCE = {
  MetamorphChrysalis: 'src/metamorph/art/MetamorphChrysalis.sol:MetamorphChrysalis',
  MetamorphButterfly: 'src/metamorph/art/MetamorphButterfly.sol:MetamorphButterfly',
  MetamorphArt: 'src/metamorph/art/MetamorphArt.sol:MetamorphArt',
  MetamorphMD: 'src/metamorph/MetamorphMD.sol:MetamorphMD',
};
/** The rehearsal's eight cards, in the order script/RehearseMetamorphArt.s.sol mints them. */
const CARDS = [
  "chrysalis, plain: seat 1376, the holotype (the deploy script's sample card)",
  'chrysalis, gilt: seat 8296, round 2, the heaviest card of all',
  'chrysalis, plain: seat 107',
  'chrysalis, plain: seat 64, edition 2, a paratype',
  'butterfly, plain: seat 1376, the holotype',
  'butterfly, gilt: seat 8296, round 2, the heaviest card of all',
  'butterfly, plain: seat 35, edition 279, a series card',
  'butterfly, plain: seat 2, edition 48, a series card',
];
const RECORDED_KEYS = ['metamorphChrysalis', 'metamorphButterfly', 'metamorphArt', 'metamorph', 'rehearsal'];
const CLI = 'node script/mainnet/metamorph.mjs';

// ------------------------------------------------------------------ arguments, environment

const flags = { yes: false, dryRun: false, again: false, rpc: '', key: '', book: '', site: '' };
let cmd = '';
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--yes') flags.yes = true;
  else if (a === '--dry-run') flags.dryRun = true;
  else if (a === '--again') flags.again = true;
  else if (a === '--rpc' || a === '--key' || a === '--book' || a === '--site') {
    if (!process.argv[i + 1]) fail(`${a} takes a value`);
    flags[a.slice(2)] = process.argv[++i];
  } else if (a.startsWith('-')) fail(`unknown flag ${a}`);
  else if (cmd) fail(`one step at a time: ${cmd} and ${a}`);
  else cmd = a;
}
cmd ||= 'status';
const steps = { status, art, rehearsal, token, record };
if (!steps[cmd]) fail(`unknown step ${cmd}; one of: ${Object.keys(steps).join(', ')}`);

const dotenv = readDotEnv();
const env = (k) => process.env[k] || dotenv[k] || '';
const RPC = flags.rpc || env('MAINNET_RPC_URL');
const KEY = flags.key || env('KEEPER_PRIVATE_KEY');
const MAX_BASE_FEE_GWEI = Number(env('MAX_BASE_FEE_GWEI') || 2);
if (!RPC) fail('MAINNET_RPC_URL is not set (environment or .env), and no --rpc');
if (!/^0x[0-9a-fA-F]{64}$/.test(KEY)) fail('KEEPER_PRIVATE_KEY is not set or not a 0x-prefixed 32-byte key, and no --key');
if (!(MAX_BASE_FEE_GWEI >= 0)) fail('MAX_BASE_FEE_GWEI is not a number');

/** What the runbook says not to do: printed as refused, nothing sent, nothing recorded. */
class Refusal extends Error {}
/** The owner's no at a question. */
class Stop extends Error {}

Promise.resolve()
  .then(() => steps[cmd]())
  .catch((e) => {
    const how = e instanceof Refusal ? 'refused' : e instanceof Stop ? 'stopped' : 'failed';
    console.error(`\n${cmd} ${how}: ${scrub(how === 'failed' ? e.stack || e.message : e.message)}`);
    process.exitCode = 1;
  })
  .finally(() => stdin?.close());

// ------------------------------------------------------------------ status

async function status() {
  const ctx = await ready();
  console.log('recorded:');
  for (const k of RECORDED_KEYS) {
    const a = ctx.p[k] || '';
    const b = ctx.book[k] || '';
    const where = a && b ? (same(a, b) ? 'progress and book' : `progress; the book has ${b}: THEY DISAGREE`) : a ? 'progress' : b ? 'book' : '';
    console.log(`  ${k.padEnd(19)} ${a || b || '-'}${where ? `  (${where})` : ''}`);
  }
  let bad = 0;
  let router = '';
  try {
    router = recorded(ctx, 'metamorphArt');
  } catch (e) {
    console.log(`  FAIL ${e.message}`);
    bad++;
  }
  if (router) {
    console.log(`the art, router ${router}:`);
    bad += await artChecks(ctx, router, {
      chrysalis: ctx.p.metamorphChrysalis || ctx.book.metamorphChrysalis,
      butterfly: ctx.p.metamorphButterfly || ctx.book.metamorphButterfly,
    });
  }
  let md = '';
  try {
    md = recorded(ctx, 'metamorph');
  } catch (e) {
    console.log(`  FAIL ${e.message}`);
    bad++;
  }
  if (md) {
    console.log(`the token ${md}:`);
    bad += await tokenChecks(ctx, md, router);
  }
  if (ctx.p.rehearsal) {
    console.log(`the rehearsal ${ctx.p.rehearsal}: ${(await hasCode(ctx.p.rehearsal)) ? 'code present' : 'NO CODE'}; its cards https://opensea.io/assets/ethereum/${ctx.p.rehearsal}/1 to /8`);
  }
  if (bad) {
    console.log(`${bad} check(s) FAILED`);
    process.exitCode = 1;
  }
  console.log(`next: ${bad ? 'look at the FAIL lines first' : nextStep(ctx)}`);
}

// ------------------------------------------------------------------ art (step 1)

async function art() {
  const ctx = await ready();
  const have = recorded(ctx, 'metamorphArt');
  if (have && !flags.again) {
    throw new Refusal(`metamorphArt is already recorded: ${have} (${where(ctx, 'metamorphArt')}). The art is deployed once; --again deploys another set and records it over this one.`);
  }
  const md = recorded(ctx, 'metamorph');
  if (md) console.log(`note: the token ${md} is recorded and keeps the art it was deployed with (ART is immutable); a new art serves only a new token`);

  step('the art: MetamorphChrysalis, MetamorphButterfly, then the router MetamorphArt with their addresses (DeployMetamorphArt.s.sol)');
  console.log('dry run, no --broadcast:');
  const dry = forgeScript(ctx, SCRIPT.art, {}, { dry: true });
  const planned = Object.fromEntries(['MetamorphChrysalis', 'MetamorphButterfly', 'MetamorphArt'].map((n) => [n, grab(dry.out, n)]));
  const bad = verify([
    ['sample chrysalis tokenURI bytes', sampleBytes(dry.out, 'chrysalis'), EXPECT.chrysalisUri],
    ['sample butterfly tokenURI bytes', sampleBytes(dry.out, 'butterfly'), EXPECT.butterflyUri],
  ]);
  if (bad) throw new Refusal('the dry run does not draw the sample card at the lengths the code fixes; nothing sent. The source is not the reviewed one: do not deploy it.');
  await estimate(ctx, dry);
  if (flags.dryRun) return dryRunOnly();
  await keeperStopped("the router takes the two figures' addresses, which follow from the deployer's nonce at the simulation: a keeper transaction in between (the deploy key is the keeper's) leaves a router pointing at addresses with no code, for good");
  await underCap();
  if (!(await ask('broadcast? (yes/no)'))) throw new Stop('nothing sent');

  step('broadcasting the three transactions');
  const sent = forgeScript(ctx, SCRIPT.art, {}, { dry: false });
  const got = Object.fromEntries(['MetamorphChrysalis', 'MetamorphButterfly', 'MetamorphArt'].map((n) => [n, created(sent.record, n)]));
  for (const [n, c] of Object.entries(got)) {
    const logged = grab(sent.out, n);
    if (!same(logged, c.address)) throw new Error(`forge logged ${n} ${logged}, but its broadcast record has ${c.address}`);
    console.log(`  ${n.padEnd(19)} ${c.address}  gas ${c.gas.toLocaleString('en-US')}  block ${c.block}${same(planned[n], c.address) ? '' : `  (the dry run had ${planned[n]}: the nonce moved in between)`}`);
  }
  const router = got.MetamorphArt.address;

  step('checking the art on chain');
  await settled(ctx, 'the three contracts', async () => (await hasCode(router)) && (await hasCode(got.MetamorphChrysalis.address)) && (await hasCode(got.MetamorphButterfly.address)));
  const failed = await artChecks(ctx, router, { chrysalis: got.MetamorphChrysalis.address, butterfly: got.MetamorphButterfly.address });
  if (failed) {
    throw new Refusal(`${failed} check(s) failed; nothing recorded. Nothing has taken this art, so it is only abandoned, at the gas of three contracts: run \`art\` again and check again.`);
  }
  const p = ctx.p;
  if (have) {
    p.abandonedArt = [...(p.abandonedArt || []), {
      metamorphChrysalis: p.metamorphChrysalis || ctx.book.metamorphChrysalis || null,
      metamorphButterfly: p.metamorphButterfly || ctx.book.metamorphButterfly || null,
      metamorphArt: have,
    }];
  }
  p.metamorphChrysalis = got.MetamorphChrysalis.address;
  p.metamorphButterfly = got.MetamorphButterfly.address;
  p.metamorphArt = router;
  p.artBlock = got.MetamorphArt.block;
  p.artAt = new Date().toISOString();
  saveProgress(ctx);
  writeBook(ctx, { metamorphArt: router, metamorphChrysalis: got.MetamorphChrysalis.address, metamorphButterfly: got.MetamorphButterfly.address });
  verifyHints(ctx, got);
  console.log(`\nMetamorphArt ${router}`);
  console.log(`next: ${CLI} rehearsal   (the cards on OpenSea and in a wallet before the token takes the art; recommended, not required)`);
  console.log(`      ${CLI} token`);
}

// ------------------------------------------------------------------ rehearsal (between steps 1 and 2)

async function rehearsal() {
  const ctx = await ready();
  const router = recorded(ctx, 'metamorphArt');
  if (!router) throw new Refusal('no metamorphArt is recorded: run `art` first; the rehearsal wears the router that is deployed');
  if (ctx.p.rehearsal && !flags.again) {
    throw new Refusal(`a rehearsal is already recorded: ${ctx.p.rehearsal}; look at its cards, or --again deploys another\n${cardLinks(ctx, ctx.p.rehearsal)}`);
  }

  step(`the rehearsal: MetamorphRehearsal, a throwaway ERC-721 wearing the router ${router} (RehearseMetamorphArt.s.sol with ART=<router>)`);
  console.log('the router first:');
  if (await artChecks(ctx, router)) throw new Refusal("the router does not pass step 1's checks; nothing sent");
  console.log('dry run, no --broadcast:');
  const dry = forgeScript(ctx, SCRIPT.rehearsal, { ART: router }, { dry: true });
  const existing = grab(dry.out, 'MetamorphArt \\(existing\\)');
  if (!same(existing, router)) throw new Error(`the script wears ${existing}, not the router ${router}`);
  const tokens = tokenLines(dry.out);
  if (tokens.length !== 8) throw new Refusal(`the dry run lists ${tokens.length} tokens, not the eight cards`);
  const bad = verify([
    ['token 1, the holotype chrysalis, tokenURI bytes', tokens[0].bytes, EXPECT.chrysalisUri],
    ['token 5, the holotype butterfly, tokenURI bytes', tokens[4].bytes, EXPECT.butterflyUri],
  ]);
  if (bad) throw new Refusal('the rehearsal does not draw the holotype at the lengths the code fixes; nothing sent');
  await estimate(ctx, dry);
  if (flags.dryRun) return dryRunOnly();
  await underCap();
  if (!(await ask('broadcast? (yes/no)'))) throw new Stop('nothing sent');

  step('broadcasting the rehearsal');
  const sent = forgeScript(ctx, SCRIPT.rehearsal, { ART: router }, { dry: false });
  const got = created(sent.record, 'MetamorphRehearsal');
  const logged = grab(sent.out, 'MetamorphRehearsal');
  if (!same(logged, got.address)) throw new Error(`forge logged MetamorphRehearsal ${logged}, but its broadcast record has ${got.address}`);
  console.log(`  MetamorphRehearsal  ${got.address}  gas ${got.gas.toLocaleString('en-US')}  block ${got.block}`);

  step('checking the rehearsal on chain');
  await settled(ctx, 'the rehearsal', () => hasCode(got.address));
  const one = await uriBytes(got.address, 'tokenURI(uint256)', '1');
  const five = await uriBytes(got.address, 'tokenURI(uint256)', '5');
  const failed = verify([
    ['ART() is the router', call(got.address, 'ART()(address)')[0], router],
    ['tokenURI(1) bytes', one.length, EXPECT.chrysalisUri],
    ['tokenURI(5) bytes', five.length, EXPECT.butterflyUri],
    [`tokenURI begins ${DATA_URI}`, one.prefix === DATA_URI && five.prefix === DATA_URI, true],
  ]);
  if (failed) throw new Refusal(`${failed} check(s) failed; nothing recorded. The rehearsal is a throwaway: deploy it again.`);
  const p = ctx.p;
  if (p.rehearsal) p.earlierRehearsals = [...(p.earlierRehearsals || []), p.rehearsal];
  p.rehearsal = got.address;
  p.rehearsalAt = new Date().toISOString();
  saveProgress(ctx);
  console.log('  recorded in the progress file only; nothing from the rehearsal goes in the address book');
  console.log(`\n${cardLinks(ctx, got.address)}`);
  console.log(`next: ${CLI} token   (once the cards look right)`);
}

// ------------------------------------------------------------------ token (step 2)

async function token() {
  const ctx = await ready();
  const router = recorded(ctx, 'metamorphArt');
  if (!router) throw new Refusal('no metamorphArt is recorded: run `art` first; the token takes the router as ART, for good');
  const have = recorded(ctx, 'metamorph');
  if (have && !flags.again) {
    throw new Refusal(`metamorph is already recorded: ${have} (${where(ctx, 'metamorph')}). The token is deployed once; --again deploys another and records it over this one.`);
  }
  const missing = ['cocoon', 'hook', 'token', 'imd', 'collection', 'poolManager'].filter((k) => !ctx.book[k]);
  if (missing.length) throw new Refusal(`the address book lacks ${missing.join(', ')}`);
  if (!ctx.p.rehearsal) console.log('note: no rehearsal is recorded (`rehearsal` shows a card on OpenSea and in a wallet before the token takes the art; recommended, not required)');

  step(`the token: MetamorphMD at ${MIN_BITS} bits, ART being ${router} (DeployMetamorph.s.sol)`);
  console.log('the router first (the runbook: if any of the four differs, do not run step 2):');
  if (await artChecks(ctx, router)) throw new Refusal("the router does not pass step 1's checks; nothing sent");
  const scriptEnv = {
    COCOON: ctx.book.cocoon,
    HOOK: ctx.book.hook,
    PUPATE: ctx.book.token,
    IMD: ctx.book.imd,
    COLLECTION: ctx.book.collection,
    POOL_MANAGER: ctx.book.poolManager,
    ART: router,
    MIN_BITS: String(MIN_BITS),
  };
  console.log(`the script's environment, from ${rel(ctx.bookFile)}:`);
  for (const [k, v] of Object.entries(scriptEnv)) console.log(`  ${k.padEnd(13)} ${v}`);
  console.log('dry run, no --broadcast (-vv; the script itself refuses an ART that does not draw, and the constructor a wrong wiring):');
  const dry = forgeScript(ctx, SCRIPT.token, scriptEnv, { dry: true, verbosity: '-vv' });
  const planned = grab(dry.out, 'MetamorphMD');
  const bits = (dry.out.match(/^\s*target bits\s+(\d+)\s*$/m) || [])[1];
  if (bits !== String(MIN_BITS)) throw new Refusal(`the dry run reports target bits ${bits ?? '?'}, not ${MIN_BITS}; nothing sent`);
  await estimate(ctx, dry);
  if (flags.dryRun) return dryRunOnly();
  await keeperStopped("the deploy key is the keeper's: a keeper transaction in between takes the nonce the simulation assumed and the broadcast fails or lands elsewhere; the keeper starts again once the token is recorded");
  await underCap();
  if (!(await ask('broadcast? (yes/no)'))) throw new Stop('nothing sent');

  step('broadcasting the token');
  const sent = forgeScript(ctx, SCRIPT.token, scriptEnv, { dry: false, verbosity: '-vv' });
  const got = created(sent.record, 'MetamorphMD');
  const logged = grab(sent.out, 'MetamorphMD');
  if (!same(logged, got.address)) throw new Error(`forge logged MetamorphMD ${logged}, but its broadcast record has ${got.address}`);
  console.log(`  MetamorphMD         ${got.address}  gas ${got.gas.toLocaleString('en-US')}  block ${got.block}${same(planned, got.address) ? '' : `  (the dry run had ${planned}: the nonce moved in between)`}`);

  step('checking the token on chain');
  await settled(ctx, 'the token', () => hasCode(got.address));
  const failed = await tokenChecks(ctx, got.address, router);
  if (failed) throw new Refusal(`${failed} check(s) failed; nothing recorded. Look before anything else: the token cannot be corrected.`);
  const p = ctx.p;
  if (have) p.abandonedTokens = [...(p.abandonedTokens || []), have];
  p.metamorph = got.address;
  p.tokenBlock = got.block;
  p.tokenAt = new Date().toISOString();
  saveProgress(ctx);
  writeBook(ctx, { metamorph: got.address });
  verifyHints(ctx, { MetamorphMD: got });
  console.log(`\nMetamorphMD ${got.address}`);
  console.log(`next: ${CLI} record   (then the keeper loop starts again; it takes the mine's duties once the address book reaches it)`);
}

// ------------------------------------------------------------------ record (steps 3 and 4)

async function record() {
  const ctx = await ready();
  const router = recorded(ctx, 'metamorphArt');
  const md = recorded(ctx, 'metamorph');
  if (!router) throw new Refusal('no metamorphArt is recorded: run `art` first');
  if (!md) throw new Refusal('no metamorph is recorded: run `token` first');
  const siteFile = flags.site ? resolve(flags.site) : join(ROOT, 'site', 'lib', 'addresses.ts');
  if (ctx.local && !flags.site) throw new Refusal("on the local fork, record needs --site <a scratch copy of site/lib/addresses.ts>: that file's MAINNET object is mainnet's");

  step(`the two addresses in ${rel(ctx.bookFile)} and in MAINNET of ${rel(siteFile)}`);
  writeBook(ctx, {
    metamorphArt: router,
    metamorphChrysalis: ctx.p.metamorphChrysalis || ctx.book.metamorphChrysalis || '',
    metamorphButterfly: ctx.p.metamorphButterfly || ctx.book.metamorphButterfly || '',
    metamorph: md,
  });
  const changed = recordSite(siteFile, { metamorph: md, metamorphArt: router });
  console.log(`  ${rel(siteFile)}: MAINNET ${changed ? 'gained' : 'already has'} metamorph ${md} and metamorphArt ${router}`);
  ctx.p.recordedAt = new Date().toISOString();
  saveProgress(ctx);

  step('by hand, in this order (the runbook, steps 3 and 4)');
  if (ctx.local) console.log('(the local fork: nothing of this is committed or deployed; the lines are what the mainnet run prints)\n');
  console.log(`the commit:
  git add ${rel(ctx.bookFile)} ${rel(siteFile)}
  git commit -m "mainnet: Metamorph MD and its art recorded"
  git push origin main

the keeper, on the VPS (it reads metamorph from the address book only; no environment variable names it):
  ADDRESSES=/opt/pupate/app/keeper/addresses.mainnet.json     in the keeper's .env: an absolute path, the keeper runs in keeper/
  node keeper/bin/keeper.mjs --once --dry-run                  the decisions once, nothing sent; the address line ends with " metamorph ${md}"
  bash deploy/update.sh                                        pulls and restarts the loop (or: pm2 restart pupate-keeper --update-env)
  from the next tick on it notes every seat the vault holds, forgets the sold ones, converts the pot at 20 mint prices and pokes the emerged cards

the site, from site/ (the deployment that carries the two addresses is the one that opens the mine):
  remove NEXT_PUBLIC_PREREGISTER_URL from the site's environment (Vercel: Settings, Environment Variables, Production): the pre-register card leaves the build
  npm run mine-live                                            the end-to-end run on the local stack; must end with "mine-live: 23 of 23 steps passed"
  npm run copy-check && npm run typecheck && npm run build
  vercel --prod --yes
  then https://pupate.fun/mine/: no preview chip, the mint price, the epoch and the numbers from the chain; "Ready. Nothing to mine
  until the vault holds a seat." until the keeper notes the first seat, when the page switches on by itself`);
}

// ------------------------------------------------------------------ the chain, the files

/** The chain, the deployer, the base fee, the address book and the progress file: the first lines of every step. */
async function ready() {
  const chainId = Number(await rpc('eth_chainId'));
  const local = chainId === 31337;
  if (chainId !== 1 && !local) throw new Refusal(`the RPC answers with chain id ${chainId}, neither mainnet (1) nor the local fork (31337)`);
  const head = await rpc('eth_getBlockByNumber', ['latest', false]);
  const baseFee = BigInt(head.baseFeePerGas ?? 0);
  const deployer = castLocal('wallet', 'address', '--private-key', KEY);
  if (!/^0x[0-9a-fA-F]{40}$/.test(deployer)) throw new Error('cast wallet address gave no address for the key');
  const balance = BigInt(await rpc('eth_getBalance', [deployer, 'latest']));
  console.log(`chain ${chainId} (${local ? 'local' : 'mainnet'}), block ${Number(head.number)}, base fee ${fmtGwei(baseFee)} (cap ${MAX_BASE_FEE_GWEI} gwei)`);
  console.log(`deployer ${deployer}: ${fmtEth(balance)}`);
  const bookFile = flags.book ? resolve(flags.book) : join(ROOT, ...(local ? ['site', 'public', 'addresses.local.json'] : ['keeper', 'addresses.mainnet.json']));
  if (!existsSync(bookFile)) throw new Refusal(`the address book ${bookFile} is missing${local ? ': run `node script/local/up.mjs` first' : ''}`);
  const book = JSON.parse(readFileSync(bookFile, 'utf8'));
  if (Number(book.chainId) !== chainId) throw new Refusal(`${bookFile} is for chain ${book.chainId}, but the RPC answers with chain id ${chainId}`);
  const progressFile = join(ROOT, 'keeper', '.launch', local ? 'metamorph.local.json' : 'metamorph.json');
  let p = existsSync(progressFile) ? JSON.parse(readFileSync(progressFile, 'utf8')) : {};
  if (p.deployer && !same(p.deployer, deployer)) throw new Refusal(`the key is ${deployer}, but ${progressFile} was written by ${p.deployer}`);
  if (p.chainId && Number(p.chainId) !== chainId) throw new Refusal(`${progressFile} is for chain ${p.chainId}`);
  if (local && p.metamorphArt && !(await hasCode(p.metamorphArt))) {
    // A fork is thrown away with `up.mjs down`; its progress file is not. On mainnet a router without code is a finding, not a fresh start.
    console.log(`${rel(progressFile)} names a router with no code on this fork (an earlier fork's): starting afresh`);
    p = {};
  }
  p.chainId = chainId;
  p.deployer = deployer;
  console.log(`address book ${rel(bookFile)}; progress ${rel(progressFile)}${existsSync(progressFile) ? '' : ' (none yet)'}`);
  return { chainId, local, deployer, balance, baseFee, book, bookFile, p, progressFile };
}

/** What the progress file and the address book record under `key`, which must agree; '' when neither has it. */
function recorded(ctx, key) {
  const a = ctx.p[key] || '';
  const b = ctx.book[key] || '';
  if (a && b && !same(a, b)) throw new Refusal(`the progress file names ${key} ${a}, the address book ${b}; settle which is right before going on`);
  return a || b;
}

function where(ctx, key) {
  const a = ctx.p[key];
  const b = ctx.book[key];
  return a && b ? 'the progress file and the address book' : a ? 'the progress file' : 'the address book';
}

function nextStep(ctx) {
  const router = ctx.p.metamorphArt || ctx.book.metamorphArt;
  const md = ctx.p.metamorph || ctx.book.metamorph;
  if (!router) return `${CLI} art`;
  if (!md) return ctx.p.rehearsal ? `${CLI} token` : `${CLI} rehearsal (recommended), then ${CLI} token`;
  return ctx.p.recordedAt ? 'the git, keeper and site lines `record` printed (run it again to see them)' : `${CLI} record`;
}

function saveProgress(ctx) {
  mkdirSync(dirname(ctx.progressFile), { recursive: true });
  writeFileSync(ctx.progressFile, JSON.stringify(ctx.p, null, 2) + '\n');
}

/** Adds or replaces fields of the address book, the rest of the file untouched (2-space JSON, trailing newline). */
function writeBook(ctx, fields) {
  const book = JSON.parse(readFileSync(ctx.bookFile, 'utf8'));
  const touched = [];
  for (const [k, v] of Object.entries(fields)) {
    if (!v || book[k] === v) continue;
    book[k] = v;
    touched.push(k);
  }
  if (touched.length) writeFileSync(ctx.bookFile, JSON.stringify(book, null, 2) + '\n');
  ctx.book = book;
  console.log(`  ${rel(ctx.bookFile)}: ${touched.length ? `recorded ${touched.join(', ')}` : `already has ${Object.keys(fields).filter((k) => fields[k]).join(', ')}`}`);
}

/**
 * Writes `fields` into the MAINNET object of site/lib/addresses.ts (or the file given), before its closing
 * `};`, with the object's own indentation; a field already there is replaced. Returns whether the file changed.
 */
function recordSite(file, fields) {
  if (!existsSync(file)) throw new Refusal(`${file} is missing`);
  const text = readFileSync(file, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const start = text.indexOf('export const MAINNET: Addresses | null = {');
  if (start < 0) throw new Refusal(`${file} has no \`export const MAINNET: Addresses | null = {\` object`);
  const end = text.indexOf(`${eol}};`, start);
  if (end < 0) throw new Refusal(`${file}: the MAINNET object has no closing \`};\``);
  const lines = text.slice(start, end).split(eol);
  const indent = (lines.find((l) => /^\s+\w+:/.test(l)) || '  ').match(/^\s*/)[0];
  const kept = lines.filter((l) => !/^\s*(metamorph|metamorphArt)\s*:/.test(l));
  for (const [k, v] of Object.entries(fields)) kept.push(`${indent}${k}: "${v}",`);
  const out = text.slice(0, start) + kept.join(eol) + text.slice(end);
  if (out === text) return false;
  writeFileSync(file, out);
  return true;
}

// ------------------------------------------------------------------ checks

/**
 * Step 1's checks of a router, through the router: the figures' code sizes (7655, 8191) and the sample card's
 * token URI lengths in both stages (21045, 20285), plus that the URI is a base64 JSON data URI and, when the
 * figures are known, that CHRYSALIS() and BUTTERFLY() are them. Prints each; returns how many failed.
 */
async function artChecks(ctx, router, figures = {}) {
  if (!(await hasCode(router))) {
    console.log(`  FAIL the router ${router} has no code`);
    return 1;
  }
  const chrysalis = call(router, 'CHRYSALIS()(address)')[0];
  const butterfly = call(router, 'BUTTERFLY()(address)')[0];
  const checks = [];
  if (figures.chrysalis) checks.push(['CHRYSALIS() is the recorded chrysalis', chrysalis, figures.chrysalis]);
  if (figures.butterfly) checks.push(['BUTTERFLY() is the recorded butterfly', butterfly, figures.butterfly]);
  checks.push([`CHRYSALIS() ${chrysalis} code size`, await codeSize(chrysalis), EXPECT.chrysalisCode]);
  checks.push([`BUTTERFLY() ${butterfly} code size`, await codeSize(butterfly), EXPECT.butterflyCode]);
  const c = await uriBytes(router, VIEW_URI, sampleView(0, ctx.deployer));
  const b = await uriBytes(router, VIEW_URI, sampleView(1, ctx.deployer));
  checks.push(['sample chrysalis tokenURI bytes, through the router', c.length, EXPECT.chrysalisUri]);
  checks.push(['sample butterfly tokenURI bytes', b.length, EXPECT.butterflyUri]);
  checks.push([`both begin ${DATA_URI}`, c.prefix === DATA_URI && b.prefix === DATA_URI, true]);
  return verify(checks);
}

/** The token's checks: code, ART() the router, MIN_BITS() 20, COCOON() the vault; then its numbers. Returns how many failed. */
async function tokenChecks(ctx, md, router) {
  if (!(await hasCode(md))) {
    console.log(`  FAIL the token ${md} has no code`);
    return 1;
  }
  const bad = verify([
    ['ART() is the recorded router', call(md, 'ART()(address)')[0], router || '(no router recorded)'],
    [`MIN_BITS() is ${MIN_BITS}`, call(md, 'MIN_BITS()(uint8)')[0], String(MIN_BITS)],
    ['COCOON() is the vault of the address book', call(md, 'COCOON()(address)')[0], ctx.book.cocoon || '(no cocoon in the book)'],
  ]);
  const seats = call(md, 'mineableSeats()(uint256[])')[0] || '[]';
  const count = seats.replace(/[\[\]\s]/g, '') ? seats.split(',').length : 0;
  console.log(
    `  bits() ${call(md, 'bits()(uint8)')[0]}, epoch() ${call(md, 'epoch()(uint16)')[0]}, mintPrice() ${fmtPupate(callUint(md, 'mintPrice()(uint256)'))},` +
      ` totalMinted() ${call(md, 'totalMinted()(uint16)')[0]}, mineableSeats() ${count}${count ? ` ${seats}` : ''}`,
  );
  return bad;
}

/** Prints each [name, got, want] as ok or FAIL (compared as lower-case strings); returns the failures. */
function verify(checks) {
  let bad = 0;
  for (const [name, got, want] of checks) {
    const ok = String(got).toLowerCase() === String(want).toLowerCase();
    if (!ok) bad++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? (typeof want === 'number' ? ` ${want}` : '') : `: got ${got}, want ${want}`}`);
  }
  return bad;
}

// ------------------------------------------------------------------ forge

/**
 * The forge script, simulated (`dry`: no --broadcast) or broadcast. Prints its `== Logs ==` block. A dry run
 * returns the output and forge's gas estimate; a broadcast returns the output and its record from
 * broadcast/<script>/<chain>/run-latest.json, which is what was sent. Anything forge prints is scrubbed.
 */
function forgeScript(ctx, target, scriptEnv, { dry, verbosity = '' }) {
  const args = ['script', target, '--rpc-url', RPC, '--private-key', KEY, '--non-interactive'];
  if (verbosity) args.push(verbosity);
  if (!dry) {
    args.push('--broadcast', '--slow', '--gas-estimate-multiplier', '130', '--retries', '10', '--delay', '8');
    if (!ctx.local && env('ETHERSCAN_API_KEY')) args.push('--verify', '--etherscan-api-key', env('ETHERSCAN_API_KEY'));
  }
  const since = Math.floor(Date.now() / 1000) - 1;
  const r = run('forge', args, { env: scriptEnv, quiet: true });
  const out = scrub(`${r.stdout}\n${r.stderr}`);
  const logs = (out.match(/== Logs ==\s*([\s\S]*?)(?:\n\s*\n## |\n\s*\n==|\nSIMULATION|\nSKIPPING|$)/) || [])[1];
  if (dry) {
    if (r.status !== 0) throw new Error(`forge ${target} (dry run) failed (exit ${r.status})\n${out}`);
    console.log(indented(logs ?? out));
    const gas = (out.match(/Estimated total gas used for script:\s*([\d,]+)/) || [])[1];
    return {
      out,
      gas: gas ? Number(gas.replace(/,/g, '')) : 0,
      price: (out.match(/Estimated gas price:\s*([\d.]+ gwei)/) || [])[1] || '',
      required: (out.match(/Estimated amount required:\s*([\d.]+ ETH)/) || [])[1] || '',
    };
  }
  const record = broadcastRecord(ctx, target, since);
  if (r.status !== 0) {
    if (!record) throw new Error(`forge ${target} (broadcast) failed (exit ${r.status}) and left no complete broadcast record from this run; read the output before running again:\n${out}`);
    console.log(`  forge exited ${r.status} after every transaction was mined (the source verification, usually); its last lines:\n${tail(out).replace(/^/gm, '    ')}`);
  } else if (!record) {
    throw new Error(`forge ${target} reported success, but broadcast/.../run-latest.json is missing or older than this run:\n${out}`);
  }
  console.log(indented(logs ?? out));
  const paid = out.match(/Total Paid:.*$/m);
  if (paid) console.log(`  ${paid[0].trim()}`);
  return { out, record };
}

/**
 * forge's record of the last broadcast of `target` on this chain, when it is from this run and every
 * transaction in it is mined; null otherwise. A reverted transaction is an error.
 */
function broadcastRecord(ctx, target, since) {
  const file = join(ROOT, 'broadcast', basename(target.split(':')[0]), String(ctx.chainId), 'run-latest.json');
  if (!existsSync(file)) return null;
  const json = JSON.parse(readFileSync(file, 'utf8'));
  if (Number(json.timestamp) < since) return null;
  const receipts = new Map((json.receipts || []).map((r) => [String(r.transactionHash).toLowerCase(), r]));
  const txs = json.transactions || [];
  if (!txs.length) return null;
  for (const t of txs) {
    const receipt = receipts.get(String(t.hash).toLowerCase());
    if (!receipt) return null;
    if (Number(receipt.status) !== 1) throw new Error(`transaction ${t.hash} (${t.transactionType} ${t.contractName ?? ''}) reverted; see ${file}`);
  }
  return { file, txs, receipts };
}

/** The contract `name` created by a broadcast: its address (checksummed), gas, block and creation input. */
function created(record, name) {
  const t = record.txs.find((x) => x.transactionType === 'CREATE' && x.contractName === name);
  if (!t?.contractAddress) throw new Error(`${record.file} records no CREATE of ${name}`);
  const receipt = record.receipts.get(String(t.hash).toLowerCase());
  return {
    address: castLocal('to-check-sum-address', t.contractAddress),
    gas: Number(receipt.gasUsed),
    block: Number(receipt.blockNumber),
    hash: t.hash,
    input: String(t.transaction?.input ?? ''),
  };
}

/** `label 0x…` from forge's logs. */
function grab(out, label) {
  const m = out.match(new RegExp(`^\\s*${label}\\s+(0x[0-9a-fA-F]{40})\\s*$`, 'm'));
  if (!m) throw new Error(`could not find "${label.replace(/\\/g, '')} 0x..." in the script output`);
  return m[1];
}

function sampleBytes(out, stage) {
  const m = out.match(new RegExp(`sample ${stage} tokenURI bytes\\s+(\\d+)`));
  return m ? Number(m[1]) : 'not logged';
}

function tokenLines(out) {
  return [...out.matchAll(/^\s*token (\d+) stage (\d) gilt (true|false) tokenURI bytes (\d+)\s*$/gm)].map((m) => ({
    id: Number(m[1]),
    stage: Number(m[2]),
    gilt: m[3] === 'true',
    bytes: Number(m[4]),
  }));
}

/** The gas estimate of a dry run against the base fee and the balance. */
async function estimate(ctx, dry) {
  const fee = await baseFee();
  if (!dry.gas) {
    console.log('  forge printed no gas estimate');
    return;
  }
  const cost = BigInt(dry.gas) * fee;
  const required = dry.required ? `${Number(dry.required.replace(' ETH', '')).toFixed(6)} ETH` : '';
  console.log(`  estimated gas ${dry.gas.toLocaleString('en-US')} (forge's figure, its 30% margin included): about ${fmtEth(cost)} at the base fee ${fmtGwei(fee)}${required ? ` (forge: ${required} at ${dry.price})` : ''}; the deployer holds ${fmtEth(ctx.balance)}`);
  if (ctx.balance < cost) throw new Refusal(`the deployer holds ${fmtEth(ctx.balance)}, less than the ${fmtEth(cost)} the estimate costs at the current base fee; nothing sent`);
}

async function underCap() {
  const fee = await baseFee();
  const cap = BigInt(Math.round(MAX_BASE_FEE_GWEI * 1e9));
  if (fee > cap) throw new Refusal(`base fee ${fmtGwei(fee)} is above the ${MAX_BASE_FEE_GWEI} gwei cap; nothing sent. Wait, or raise MAX_BASE_FEE_GWEI knowingly.`);
  console.log(`  base fee ${fmtGwei(fee)}, under the ${MAX_BASE_FEE_GWEI} gwei cap`);
}

async function keeperStopped(why) {
  console.log(`  ${why}`);
  if (!(await ask('Is the keeper loop stopped and its last transaction mined? (yes/no)'))) {
    throw new Stop('nothing sent. Stop the keeper loop (node keeper/bin/keeper.mjs --loop, or the pm2 or systemd unit that runs it), wait until its last transaction is mined, and run this step again.');
  }
}

function dryRunOnly() {
  console.log('\n--dry-run: nothing sent, nothing asked. Run the step again without --dry-run to broadcast.');
}

/**
 * The one reader of stdin for the step's questions (a second interface would lose what the first had read),
 * the lines that arrived before their question (piped input), and whether the input has ended.
 */
let stdin = null;
let stdinEnded = false;
const typedAhead = [];

/** A yes/no question on stdin; only `yes` is yes, --yes answers it, and the end of the input is no. */
function ask(question) {
  if (flags.yes) {
    console.log(`${question} yes (--yes)`);
    return Promise.resolve(true);
  }
  if (!stdin && !stdinEnded) {
    stdin = createInterface({ input: process.stdin, output: process.stdout });
    stdin.on('line', (line) => typedAhead.push(line)); // no question was pending: kept for the next one
    stdin.on('close', () => (stdinEnded = true));
  }
  return new Promise((done) => {
    const answer = (a) => {
      const text = String(a ?? '').trim();
      if (!process.stdin.isTTY) console.log(text); // a piped answer is not echoed by a terminal
      const yes = text.toLowerCase() === 'yes';
      if (!yes) console.log(text ? `answer "${text}", not yes` : 'no answer');
      done(yes);
    };
    if (typedAhead.length || stdinEnded) {
      process.stdout.write(`${question} `);
      answer(typedAhead.shift() ?? '');
      return;
    }
    let answered = false;
    const once = (a) => {
      if (answered) return;
      answered = true;
      stdin.off('close', onClose);
      answer(a);
    };
    const onClose = () => once('');
    stdin.once('close', onClose);
    stdin.question(`${question} `, once);
  });
}

/** Source verification by hand, for a mainnet broadcast that had no Etherscan key. */
function verifyHints(ctx, contracts) {
  if (ctx.local || env('ETHERSCAN_API_KEY')) return;
  console.log('\nno ETHERSCAN_API_KEY was set: verify the source afterwards with');
  for (const [name, c] of Object.entries(contracts)) {
    const args = constructorArgs(name, c.input);
    console.log(`  forge verify-contract ${c.address} ${SOURCE[name]} --chain mainnet --watch${args ? ` --constructor-args ${args}` : ''}`);
  }
}

/** The ABI-encoded constructor arguments of a creation: what follows the compiled creation code in its input. */
function constructorArgs(name, input) {
  try {
    const [file, contract] = SOURCE[name].split(':');
    const artifact = JSON.parse(readFileSync(join(ROOT, 'out', basename(file), `${contract}.json`), 'utf8'));
    const code = String(artifact.bytecode?.object || '').toLowerCase();
    const sent = input.toLowerCase();
    if (!code || !sent.startsWith(code)) return '';
    return sent.length > code.length ? `0x${sent.slice(code.length)}` : '';
  } catch {
    return '';
  }
}

function cardLinks(ctx, address) {
  const lines = [`the eight cards of ${address}, minted to the deployer:`];
  CARDS.forEach((card, i) => lines.push(`  ${i + 1}  ${card.padEnd(72)} https://opensea.io/assets/ethereum/${address}/${i + 1}`));
  lines.push(`  Etherscan: https://etherscan.io/nft/${address}/<id>, ids 1 to 8; a wallet imports a card by the address and the id`);
  if (ctx.local) lines.push('  (the local fork: these pages know nothing of it; on mainnet they are the look)');
  lines.push(
    'What should be there, as in the browser view of out/art/: the digit contours that draw the figure and the halo rings',
    'around it, a chrysalis in its whole shell. A chrysalis without its shell, only the frame, the labels and the plain',
    'strokes left, means that marketplace or wallet rasterises on a server without <textPath>. Look in a wallet too, and',
    'only then deploy the token. Nothing from the rehearsal goes in the address book; hide the collection on OpenSea',
    'afterwards if its name should not show beside the real one.',
  );
  return lines.join('\n');
}

// ------------------------------------------------------------------ the chain

async function rpc(method, params = []) {
  const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

async function baseFee() {
  const head = await rpc('eth_getBlockByNumber', ['latest', false]);
  return BigInt(head.baseFeePerGas ?? 0);
}

async function hasCode(address) {
  return (await codeSize(address)) > 0;
}

async function codeSize(address) {
  const code = await rpc('eth_getCode', [address, 'latest']);
  return code && code !== '0x' ? (code.length - 2) / 2 : 0;
}

/** A view call, decoded by cast; one string per return value, the `[…]` annotations stripped. */
function call(to, sig, ...args) {
  const out = run('cast', ['call', to, sig, ...args.map(String), '--rpc-url', RPC]).stdout.trim();
  return out.split(/\r?\n/).map((line) => line.replace(/\s+\[[^\]]*\]\s*$/, '').trim()).filter((line) => line.length);
}

function callUint(to, sig, ...args) {
  return BigInt(call(to, sig, ...args)[0]);
}

/**
 * The byte length of a string a view returns, and its first characters, decoded from the raw eth_call
 * (the ABI's length word; no formatting of cast's in between). `sig` has no return type: cast encodes the call.
 */
async function uriBytes(to, sig, ...args) {
  const data = castLocal('calldata', sig, ...args.map(String));
  const hex = await rpc('eth_call', [{ to, data }, 'latest']);
  if (!hex || hex.length < 2 + 128) throw new Error(`${sig} at ${to} returned ${hex}`);
  const length = parseInt(hex.slice(2 + 64, 2 + 128), 16);
  const prefix = Buffer.from(hex.slice(2 + 128, 2 + 128 + DATA_URI.length * 2), 'hex').toString('latin1');
  return { length, prefix };
}

/** Three agreeing polls before a step reads what the broadcast did: the provider's nodes lag each other. */
async function settled(ctx, what, predicate) {
  const everyMs = ctx.local ? 250 : 6_000;
  const timeoutMs = ctx.local ? 30_000 : 300_000;
  const started = Date.now();
  let agree = 0;
  while (Date.now() - started < timeoutMs) {
    let ok = false;
    try {
      ok = await predicate();
    } catch {
      ok = false;
    }
    agree = ok ? agree + 1 : 0;
    if (agree >= 3) {
      console.log(`  ${what}: final (${Math.round((Date.now() - started) / 1000)} s)`);
      return;
    }
    await sleep(everyMs);
  }
  throw new Error(`${what} did not settle within ${timeoutMs / 1000} s`);
}

// ------------------------------------------------------------------ small things

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const fmtPupate = (wei) => `${(Number(wei) / 1e18).toLocaleString('en-US')} PUPATE`;

function rel(file) {
  const r = relative(ROOT, file);
  return (r && !r.startsWith('..') ? r : file).split('\\').join('/');
}

function scrub(text) {
  let out = String(text);
  for (const secret of [RPC, KEY, env('ETHERSCAN_API_KEY')]) {
    if (secret) out = out.split(secret).join('<redacted>');
  }
  try {
    out = out.split(new URL(RPC).host).join('<rpc-host>');
  } catch {
    // not a URL
  }
  return out;
}

/** forge's lines two spaces in, whatever indentation they came with. */
function indented(text) {
  return text.trimEnd().split(/\r?\n/).map((l) => `  ${l.replace(/^ {0,2}/, '')}`).join('\n');
}

function tail(text, lines = 12) {
  return text.trimEnd().split(/\r?\n/).slice(-lines).join('\n');
}

function step(title) {
  console.log(`\n== ${title}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fail(msg) {
  console.error(msg);
  process.exit(2);
}
