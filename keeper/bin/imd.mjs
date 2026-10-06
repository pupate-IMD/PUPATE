#!/usr/bin/env node
// imd: Pupate's command line for the IMD control plane.
//
//   node bin/imd.mjs capabilities
//   node bin/imd.mjs check <action> <body.json>          free check, nothing held
//   node bin/imd.mjs import <github-url> [contracts|site|code] [ref]
//   node bin/imd.mjs request <action> <body.json>        quote, pay (two signatures), wait for admission
//   node bin/imd.mjs status <orderId>
//   node bin/imd.mjs attestation <oracleRequestId>       the typed data and signature for FloorFeed
//   node bin/imd.mjs floor-body <floorFeedAddress> [consumerChainId]   write questions/floor.quote.json
//
// Environment: IMD_API (default https://api.imd.fun), IMD_PAID_TOKEN (kept in .imd/token when
// unset), KEEPER_PRIVATE_KEY (for request), PAYMENT_CHAIN_ID (default 1).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, sepolia } from 'viem/chains';
import { createImd, newRequestToken } from '../lib/imd.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const api = process.env.IMD_API || 'https://api.imd.fun';
const [cmd, ...args] = process.argv.slice(2);

function readJson(file) {
  return JSON.parse(readFileSync(file === '-' ? 0 : file, 'utf8'));
}

function requestToken() {
  if (process.env.IMD_PAID_TOKEN) return process.env.IMD_PAID_TOKEN;
  const dir = join(root, '.imd');
  const file = join(dir, 'token');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  mkdirSync(dir, { recursive: true });
  const token = newRequestToken();
  writeFileSync(file, token + '\n', { mode: 0o600 });
  console.error(`new request token written to ${file}; it is what reads your orders later`);
  return token;
}

function signer() {
  const key = process.env.KEEPER_PRIVATE_KEY;
  if (!key) throw new Error('KEEPER_PRIVATE_KEY is needed to pay');
  const chainId = Number(process.env.PAYMENT_CHAIN_ID || 1);
  const chain = chainId === 1 ? mainnet : chainId === 11155111 ? sepolia : { ...mainnet, id: chainId };
  return createWalletClient({ account: privateKeyToAccount(key), chain, transport: http() });
}

function print(v) {
  console.log(JSON.stringify(v, null, 2));
}

/** The floor question FloorFeed consumes. Keep the wording identical across requests: the hash is the pin. */
function floorQuestion() {
  return readFileSync(join(root, 'questions', 'floor.question.txt'), 'utf8').trim();
}

async function main() {
  switch (cmd) {
    case 'capabilities':
      return print(await createImd({ api }).capabilities());

    case 'check': {
      const [action, file] = args;
      const body = readJson(file);
      const input = body.action && body.input ? body.input : body;
      const out = await createImd({ api }).check(action, input);
      print(out);
      process.exitCode = out.blockers?.length ? 2 : 0;
      return;
    }

    case 'import': {
      const [url, kind = 'contracts', ref] = args;
      return print(await createImd({ api }).importRepo(url, kind, ref));
    }

    case 'request': {
      const [action, file] = args;
      const body = readJson(file);
      const input = body.action && body.input ? body.input : body;
      const imd = createImd({ api, token: requestToken(), signer: signer(), chainId: Number(process.env.PAYMENT_CHAIN_ID || 1) });
      const check = await imd.check(action, input);
      if (check.blockers?.length) {
        print(check);
        throw new Error('the check has blockers; nothing was quoted');
      }
      const { order } = await imd.quote(action, input);
      console.error(`quoted order ${order.id}: ${order.quote.amount} atomic IMD, expires ${order.quote.expiresAt}`);
      await imd.pay(order.id);
      console.error('paid; waiting for admission');
      const final = await imd.waitAdmitted(order.id);
      return print(final);
    }

    case 'status':
      return print(await createImd({ api, token: requestToken() }).status(args[0]));

    case 'attestation':
      return print(await createImd({ api }).oracleAttestation(args[0]));

    case 'floor-body': {
      const [feed, consumerChainId = '1'] = args;
      if (!feed) throw new Error('floor-body needs the FloorFeed address');
      const checkBody = { action: 'oracle.request', input: { question: floorQuestion(), panelSize: 5 } };
      const quoteBody = {
        action: 'oracle.request',
        input: {
          question: floorQuestion(),
          chainId: 1,
          window: { hours: 24 },
          answerType: 'uint256',
          evidence: 'chain',
          panelSize: 5,
          quorum: 4,
          toleranceBps: 0,
          validForSeconds: 86400,
          consumer: { chainId: Number(consumerChainId), verifyingContract: feed },
          definitions: {
            sale: 'One Seaport 1.6 OrderFulfilled event whose offer transfers exactly one ERC-721 token of the collection and whose consideration items are all native ETH or WETH.',
            price: 'The sum of that event\'s consideration amounts, in wei.',
            median: 'The middle value of the sorted prices; for an even count, the lower of the two middle values.',
            missing: 'Fewer than 3 sales in the window means unavailable. Never substitute an ask, a bid or an older sale.',
          },
          guards: { sources: ['https://etherscan.io'], minSources: 1 },
        },
      };
      mkdirSync(join(root, 'questions'), { recursive: true });
      writeFileSync(join(root, 'questions', 'floor.check.json'), JSON.stringify(checkBody, null, 2) + '\n');
      writeFileSync(join(root, 'questions', 'floor.quote.json'), JSON.stringify(quoteBody, null, 2) + '\n');
      console.error('wrote questions/floor.check.json and questions/floor.quote.json');
      return;
    }

    default:
      console.error(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 14).join('\n').replace(/^\/\/ ?/gm, ''));
      process.exitCode = cmd ? 1 : 0;
  }
}

main().catch((e) => {
  console.error(e.message);
  if (e.body) console.error(JSON.stringify(e.body, null, 2));
  process.exitCode = 1;
});
