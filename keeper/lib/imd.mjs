// The IMD paid-action client: free checks, quotes, the two-signature payment, and polling.
// Follows https://imd.fun/docs/#paid. Network: the IMD control plane only; the server pays the gas
// of the payment itself. The paying wallet needs IMD and a one-time Permit2 allowance for IMD.
import { randomBytes, randomUUID } from 'node:crypto';
import { x402Client } from '@x402/core/client';
import { encodePaymentSignatureHeader } from '@x402/core/http';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { sha256, stringToBytes } from 'viem';

export const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
export const IMD_TOKEN = '0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7';

/** Canonical JSON: sorted keys, no whitespace, integers only, no undefined. */
export function canon(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

export class ImdError extends Error {
  constructor(status, body) {
    super(`IMD ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

/**
 * @param {object} o
 * @param {string} [o.api] control plane, default https://api.imd.fun
 * @param {string} [o.token] the request token (random 32-byte hex); it reads your orders later
 * @param {import('viem').WalletClient} [o.signer] viem wallet client with an account, for payments
 * @param {number} [o.chainId] the chain the payment is made on (mainnet: 1)
 */
export function createImd({ api = 'https://api.imd.fun', token, signer, chainId = 1 } = {}) {
  const auth = token ? { Authorization: `Bearer ${token}` } : {};

  async function call(method, path, { body, headers } = {}) {
    const res = await fetch(`${api}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...auth, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, json };
  }

  async function expect(method, path, opts, ok = [200, 201, 202]) {
    const { status, json } = await call(method, path, opts);
    if (!ok.includes(status)) throw new ImdError(status, json);
    return json;
  }

  return {
    /** What a quote would say. Free, no token, nothing held. */
    check: (action, input) => expect('POST', '/requests/check', { body: { action, input } }),

    /** Register a public GitHub repository as a starting source. Free. */
    importRepo: (url, kind, ref) => expect('POST', '/requests/import', { body: { url, ref, kind } }),

    capabilities: () => expect('GET', '/requests/capabilities'),

    /** Reserve a price for 600 seconds. Reuse the same requestKey to retry the same quote. */
    quote: (action, input, requestKey = randomUUID()) =>
      expect('POST', '/requests/quote', { body: { requestKey, action, input } }),

    status: (orderId) => expect('GET', `/requests/${orderId}`),

    oracleRequest: (requestId) => expect('GET', `/oracle/requests/${requestId}`),
    oracleAttestation: (requestId) => expect('GET', `/oracle/requests/${requestId}/attestation`),

    /**
     * Pay for a quoted order: fetch the 402 challenge, sign the Permit2 payment and the EIP-712
     * quote approval with the same wallet, and submit both. Safe to repeat with the same bytes.
     */
    async pay(orderId) {
      if (!signer) throw new Error('a signer is needed to pay');
      const url = `/requests/${orderId}/submit`;

      // 1. the challenge: its JSON carries quote, requesterScopeHash and resourceUrl
      const { status, json: ch } = await call('POST', url);
      if (status !== 402) throw new ImdError(status, ch);
      const req = ch.accepts[0];
      const q = ch.quote;

      // 2. the Permit2 payment, as a stock x402 client makes it, without extensions
      const client = x402Client.fromConfig({
        schemes: [{ network: req.network, client: new ExactEvmScheme(signer) }],
      });
      const { extensions, ...generated } = await client.createPaymentPayload({
        x402Version: 2,
        resource: ch.resource,
        accepts: [req],
      });
      const payment = JSON.parse(JSON.stringify({ ...generated, accepted: req }));

      // 3. the quote approval of that exact payment
      const quoteSignature = await signer.signTypedData({
        account: signer.account,
        domain: { name: 'IdentityMD Paid Action', version: '1', chainId },
        types: {
          QuoteApproval: [
            { name: 'resource', type: 'string' },
            { name: 'requesterScopeHash', type: 'bytes32' },
            { name: 'quoteId', type: 'string' },
            { name: 'quoteHash', type: 'bytes32' },
            { name: 'paymentHash', type: 'bytes32' },
            { name: 'action', type: 'string' },
            { name: 'asset', type: 'address' },
            { name: 'amount', type: 'uint256' },
            { name: 'payTo', type: 'address' },
            { name: 'expiresAt', type: 'uint256' },
          ],
        },
        primaryType: 'QuoteApproval',
        message: {
          resource: ch.resourceUrl,
          requesterScopeHash: `0x${ch.requesterScopeHash}`,
          quoteId: q.id,
          quoteHash: `0x${q.quoteHash}`,
          paymentHash: sha256(stringToBytes(canon(payment))),
          action: q.action,
          asset: q.payment.asset,
          amount: BigInt(q.payment.amount),
          payTo: q.payment.payTo,
          expiresAt: BigInt(q.expiresAt),
        },
      });

      // 4. submit; if the response is lost, the same bytes can be sent again
      return expect(
        'POST',
        url,
        { body: { quoteSignature }, headers: { 'PAYMENT-SIGNATURE': encodePaymentSignatureHeader(payment) } },
        [200, 202],
      );
    },

    /** Poll until the order is admitted (or fails). */
    async waitAdmitted(orderId, { everyMs = 5000, timeoutMs = 15 * 60_000 } = {}) {
      const until = Date.now() + timeoutMs;
      for (;;) {
        const s = await expect('GET', `/requests/${orderId}`);
        if (s.status === 'admitted') return s;
        if (s.status === 'payment_failed' || s.status === 'expired') throw new ImdError(409, s);
        if (Date.now() > until) throw new Error(`order ${orderId} still ${s.status} after ${timeoutMs} ms`);
        await new Promise((r) => setTimeout(r, everyMs));
      }
    },
  };
}

export function newRequestToken() {
  return randomBytes(32).toString('hex');
}
