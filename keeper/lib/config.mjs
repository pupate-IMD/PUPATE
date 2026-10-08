// Configuration from the environment and the repository's .env (environment wins). Addresses come
// from an addresses JSON in the shape script/local/up.mjs writes, or from explicit variables. Values
// that are secrets (keys, RPC URLs, API keys) are read here and never printed anywhere.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAddress, parseEther } from 'viem';

export const KEEPER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = resolve(KEEPER_ROOT, '..');
export const STATE_DIR = join(KEEPER_ROOT, '.state');

/** The same reader as script/local/common.mjs, kept here so keeper/ does not import script/. */
export function readDotEnv(file = join(REPO_ROOT, '.env')) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const ADDRESS_KEYS = ['token', 'hook', 'cocoon', 'feed', 'poolManager', 'collection', 'seaport', 'imd'];
const ADDRESS_ENV = {
  token: 'TOKEN',
  hook: 'HOOK',
  cocoon: 'COCOON',
  feed: 'FEED',
  poolManager: 'POOL_MANAGER',
  collection: 'COLLECTION',
  seaport: 'SEAPORT',
  imd: 'IMD',
};

function num(v, fallback) {
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`not a number: ${v}`);
  return n;
}

/** "0.005", "5e15", "5000000000000000" or "0.005 ether" -> wei. Decimal strings are ether. */
function wei(v, fallbackWei) {
  if (v === undefined || v === '') return fallbackWei;
  const s = String(v).trim().replace(/\s*(ether|eth)$/i, '');
  if (/^\d+$/.test(s) && s.length > 12) return BigInt(s); // plain wei
  if (/^\d+(\.\d+)?e\d+$/i.test(s)) {
    const [m, e] = s.toLowerCase().split('e');
    const [w, f = ''] = m.split('.');
    const digits = w + f;
    const shift = Number(e) - f.length;
    if (shift < 0) throw new Error(`cannot express ${v} as an integer wei amount`);
    return BigInt(digits) * 10n ** BigInt(shift);
  }
  if (/^\d+$/.test(s)) return BigInt(s); // short integers: still wei
  return parseEther(s);
}

function list(v) {
  return (v || '')
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => getAddress(x));
}

/**
 * @param {string[]} argv process.argv.slice(2)
 * @returns the configuration; secrets live on it but no code path prints them.
 */
export function loadConfig(argv = []) {
  const dotenv = readDotEnv();
  const env = (k) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : dotenv[k]);
  const flags = new Set(argv.filter((a) => a.startsWith('--')));

  const addressesPath = env('ADDRESSES')
    ? isAbsolute(env('ADDRESSES'))
      ? env('ADDRESSES')
      : resolve(process.cwd(), env('ADDRESSES'))
    : join(REPO_ROOT, 'site', 'public', 'addresses.local.json');

  let file = null;
  if (existsSync(addressesPath)) {
    file = JSON.parse(readFileSync(addressesPath, 'utf8'));
  } else if (!env('COCOON')) {
    throw new Error(`no addresses: ${addressesPath} is missing and COCOON/HOOK/FEED/... are not set`);
  }

  const addresses = {};
  for (const key of ADDRESS_KEYS) {
    const v = env(ADDRESS_ENV[key]) || file?.[key];
    if (!v) throw new Error(`address ${key} is missing (set ${ADDRESS_ENV[key]} or provide it in ${addressesPath})`);
    addresses[key] = getAddress(v);
  }
  // Optional extras from the file, used by the status line and the tests.
  for (const key of ['timelock', 'vesting', 'universalRouter', 'quoter', 'permit2', 'attester']) {
    if (file?.[key]) addresses[key] = getAddress(file[key]);
  }
  const chainId = num(env('CHAIN_ID'), file?.chainId);
  if (!chainId) throw new Error('CHAIN_ID is not set and the addresses file has no chainId');
  const fromBlock = BigInt(env('FROM_BLOCK') ?? file?.fromBlock ?? 0);
  const poolKey = file?.poolKey ?? { fee: num(env('POOL_FEE'), 12500), tickSpacing: num(env('TICK_SPACING'), 60) };

  let rpc = env('RPC');
  if (!rpc && chainId === 31337) rpc = `http://127.0.0.1:${env('ANVIL_PORT') || 8545}`;
  if (!rpc) throw new Error('RPC is not set');

  const attestationSource = (env('ATTESTATION_SOURCE') || 'none').toLowerCase();
  if (!['none', 'imd', 'local'].includes(attestationSource)) {
    throw new Error(`ATTESTATION_SOURCE must be imd, local or unset (got ${attestationSource})`);
  }
  const listingSource = (env('LISTING_SOURCE') || 'none').toLowerCase();
  if (!['none', 'opensea', 'file'].includes(listingSource)) {
    throw new Error(`LISTING_SOURCE must be opensea, file or unset (got ${listingSource})`);
  }

  return {
    flags: {
      once: flags.has('--once'),
      loop: flags.has('--loop'),
      forceReport: flags.has('--force-report'),
      status: flags.has('--status'),
      dryRun: flags.has('--dry-run') || env('DRY_RUN') === '1' || env('DRY_RUN') === 'true',
      help: flags.has('--help') || flags.has('-h'),
    },
    addressesPath: file ? addressesPath : null,
    chainId,
    fromBlock,
    poolKey,
    addresses,
    rpc, // secret: never printed
    keeperPrivateKey: env('KEEPER_PRIVATE_KEY') || null, // secret
    loopEverySec: num(env('LOOP_EVERY'), 15),
    reportEverySec: num(env('REPORT_EVERY'), 21600),
    reportLeadSec: num(env('REPORT_LEAD'), 1800),
    reportRetrySec: num(env('REPORT_RETRY'), 300),
    minFlushWei: wei(env('MIN_FLUSH_WEI'), parseEther('0.005')),
    minBurnWei: wei(env('MIN_BURN_WEI'), parseEther('0.01')),
    minImdAuctionWei: wei(env('MIN_IMD_AUCTION_WEI'), parseEther('0.01')),
    gasPriceCapWei: BigInt(Math.round(num(env('GAS_PRICE_CAP_GWEI'), 30) * 1e9)),
    txTimeoutSec: num(env('TX_TIMEOUT'), 180),
    logChunk: num(env('LOG_CHUNK'), 50_000),
    attestationSource,
    localAttesterKey: env('LOCAL_ATTESTER_KEY') || null, // secret
    localFloorWei: wei(env('LOCAL_FLOOR_WEI'), parseEther('2.8')),
    allowLocalAttesterAnywhere: env('ALLOW_LOCAL_ATTESTER') === '1',
    imdApi: env('IMD_API') || 'https://api.imd.fun',
    imdPaidToken: env('IMD_PAID_TOKEN') || null, // secret
    paymentChainId: num(env('PAYMENT_CHAIN_ID'), 1),
    attestationTimeoutSec: num(env('ATTESTATION_TIMEOUT'), 1800),
    listingSource,
    listingsFile: env('LISTINGS_FILE')
      ? isAbsolute(env('LISTINGS_FILE'))
        ? env('LISTINGS_FILE')
        : resolve(process.cwd(), env('LISTINGS_FILE'))
      : join(KEEPER_ROOT, 'listings.json'),
    openseaApiKey: env('OPENSEA_API_KEY') || null, // secret
    openseaApi: env('OPENSEA_API') || 'https://api.opensea.io',
    openseaChain: env('OPENSEA_CHAIN') || 'ethereum',
    harvestTokens: list(env('HARVEST_TOKENS')),
    stateFile: join(STATE_DIR, `${chainId}.json`),
  };
}

/** What the keeper prints about its configuration at start: no key, no URL, no API key. */
export function describeConfig(cfg) {
  const a = cfg.addresses;
  return [
    `chain ${cfg.chainId}${cfg.addressesPath ? ` (addresses from ${cfg.addressesPath})` : ''}`,
    `cocoon ${a.cocoon} hook ${a.hook} feed ${a.feed} token ${a.token}`,
    `attestation source ${cfg.attestationSource}, listing source ${cfg.listingSource}` +
      (cfg.listingSource === 'file' ? ` (${cfg.listingsFile})` : '') +
      `, harvest tokens ${cfg.harvestTokens.length ? cfg.harvestTokens.join(',') : 'none'}`,
    `loop every ${cfg.loopEverySec}s, report every ${cfg.reportEverySec}s (lead ${cfg.reportLeadSec}s), ` +
      `min flush ${cfg.minFlushWei} wei, min burn ${cfg.minBurnWei} wei, gas cap ${Number(cfg.gasPriceCapWei) / 1e9} gwei` +
      (cfg.flags.dryRun ? ', DRY RUN' : ''),
  ];
}
