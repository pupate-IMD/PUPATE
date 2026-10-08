// An IMD oracle attestation and the checks FloorFeed runs on one, done in the browser. The
// signature check is the real one: the same EIP-712 encoding as src/oracle/OracleAttestation.sol.

import { hexToBigInt, isAddressEqual, recoverTypedDataAddress, type Address, type Hex } from "viem";

export interface Attestation {
  requestId: Hex;
  chainId: bigint;
  questionHash: Hex;
  answerType: number;
  answer: Hex;
  figure: bigint;
  fromBlock: bigint;
  toBlock: bigint;
  blockHash: Hex;
  panelJobId: Hex;
  panelSize: number;
  quorum: number;
  agreed: number;
  issuedAt: bigint;
  expiresAt: bigint;
}

export interface Signed {
  attestation: Attestation;
  signature: Hex;
  /// The contract the oracle issued it to. An attestation is bound to one consumer.
  consumer: Address;
  consumerChainId: number;
}

export const ORACLE_SIGNER: Address = "0x5598Aa9146215Bc13eb26f2c692Ad1461Fd32982";
export const ANSWER_TYPE_UINT256 = 3;
export const MIN_QUORUM = 4;
export const MIN_VALIDITY_SECONDS = 6n * 3600n;

// A real attestation the IMD oracle issued on mainnet to another project's contract. It is the one
// the Solidity tests recover the oracle's signer from. Pupate's own reports replace it at launch.
export const SAMPLE: Signed = {
  consumer: "0x37Bfb8AC7C960E558657871D41Ca70E07e7DbfFf",
  consumerChainId: 1,
  signature:
    "0xbfd589bb67b89a4f2a44bfcd689d7eb10309c1cf1e84fa42c417c162a7baf2a91fdd5e18ef891b9ae9f63882fdb3dc1e14e2bd13305b984afcf0ceb0059acfe01c",
  attestation: {
    requestId: "0x094326048c1a44078d8d6c66d775667900000000000000000000000000000000",
    chainId: 1n,
    questionHash: "0x39eecf277118e4219d50e4352a2fcf943cf802239c546d54dd4baba53c72d787",
    answerType: 3,
    answer: "0x00000000000000000000000000000000000000000000000000000000d588b5a0",
    figure: 0n,
    fromBlock: 26122900n,
    toBlock: 26122901n,
    blockHash: "0x22cd78830715d67d27849123a084fe3b854a1af74b40cd7f73c727399eef3059",
    panelJobId: "0x4d78f9ab3839475ab2993602d0501de500000000000000000000000000000000",
    panelSize: 5,
    quorum: 4,
    agreed: 4,
    issuedAt: 1791254782n,
    expiresAt: 1791276382n,
  },
};

const TYPES = {
  OracleAttestation: [
    { name: "requestId", type: "bytes32" },
    { name: "chainId", type: "uint256" },
    { name: "questionHash", type: "bytes32" },
    { name: "answerType", type: "uint8" },
    { name: "answer", type: "bytes" },
    { name: "figure", type: "uint256" },
    { name: "fromBlock", type: "uint64" },
    { name: "toBlock", type: "uint64" },
    { name: "blockHash", type: "bytes32" },
    { name: "panelJobId", type: "bytes32" },
    { name: "panelSize", type: "uint16" },
    { name: "quorum", type: "uint16" },
    { name: "agreed", type: "uint16" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
  ],
} as const;

/// Who signed it. Throws on a malformed signature.
export function recoverSigner(s: Signed): Promise<Address> {
  return recoverTypedDataAddress({
    domain: {
      name: "IdentityMD Oracle",
      version: "2",
      chainId: s.consumerChainId,
      verifyingContract: s.consumer,
    },
    types: TYPES,
    primaryType: "OracleAttestation",
    message: s.attestation,
    signature: s.signature,
  });
}

export interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

/// The checks FloorFeed.report makes that can be made without the chain: the signer, the panel,
/// the validity window and the answer's shape.
export async function verify(s: Signed): Promise<Check[]> {
  const a = s.attestation;
  let signer: Address | null = null;
  try {
    signer = Number.isInteger(a.answerType) ? await recoverSigner(s) : null;
  } catch {
    signer = null;
  }
  const signed = signer !== null && isAddressEqual(signer, ORACLE_SIGNER);
  const majority = a.quorum * 2 > a.panelSize;
  const validFor = a.expiresAt - a.issuedAt;
  const shaped = a.answerType === ANSWER_TYPE_UINT256 && a.answer.length === 66;
  return [
    {
      name: "Signed by the IMD oracle",
      pass: signed,
      detail: signer
        ? `recovered ${signer}`
        : Number.isInteger(a.answerType)
          ? "the signature does not parse"
          : "the answer type is not one this check knows",
    },
    {
      name: "Quorum is a majority of at least 4",
      pass: a.quorum >= MIN_QUORUM && majority,
      detail: `quorum ${a.quorum} of a panel of ${a.panelSize}`,
    },
    {
      name: "Enough of the panel agreed",
      pass: a.agreed >= a.quorum && a.agreed <= a.panelSize,
      detail: `${a.agreed} agreed, ${a.quorum} needed`,
    },
    {
      name: "Valid for at least 6 hours",
      pass: a.expiresAt >= a.issuedAt && validFor >= MIN_VALIDITY_SECONDS,
      detail: `valid for ${Number(validFor) / 3600} hours from issue`,
    },
    {
      name: "The answer is one non-zero number",
      pass: shaped && hexToBigInt(a.answer) !== 0n,
      detail: shaped ? `answer ${hexToBigInt(a.answer).toLocaleString("en-US")}` : "not a uint256 answer",
    },
  ];
}

// ------------------------------------------------------------------ live attestations

export const IMD_API = "https://api.imd.fun";

/// IMD's envelope: EIP-712 typed data plus the signature. The API allows browser reads (CORS *).
interface Envelope {
  requestId: string;
  domain: { name: string; version: string; chainId: number; verifyingContract: Address };
  message: Record<string, string | number>;
  signature: Hex;
  signer?: Address;
  attestedAt?: string;
}

const asBig = (v: string | number | undefined) => (typeof v === "number" ? BigInt(v) : BigInt(v ?? "0"));
const asHex = (v: string | number | undefined) => String(v ?? "0x") as Hex;
/// The oracle signs a uint8 per answer kind (3 for uint256, confirmed against a live signature);
/// the API may send the number, a numeric string, or a label. Labels other than uint256 are
/// resolved by trial: the code that recovers the attester is the code that was signed.
const asAnswerType = (v: string | number | undefined): number =>
  typeof v === "number" ? v : /^\d+$/.test(String(v ?? "")) ? Number(v) : v === "uint256" ? ANSWER_TYPE_UINT256 : NaN;

async function resolveAnswerType(signed: Signed): Promise<number> {
  if (Number.isInteger(signed.attestation.answerType)) return signed.attestation.answerType;
  for (let code = 0; code < 32; code++) {
    try {
      const who = await recoverSigner({ ...signed, attestation: { ...signed.attestation, answerType: code } });
      if (isAddressEqual(who, ORACLE_SIGNER)) return code;
    } catch {
      // not this one
    }
  }
  return NaN;
}

/// One request's attestation, fetched from IMD and shaped for `verify`.
export async function fetchAttestation(requestId: string): Promise<Signed> {
  const res = await fetch(`${IMD_API}/oracle/requests/${encodeURIComponent(requestId.trim())}/attestation`, { cache: "no-store" });
  if (!res.ok) throw new Error(res.status === 404 ? "no attestation for that request id" : `IMD answered ${res.status}`);
  const env = (await res.json()) as Envelope;
  const m = env.message;
  const signed: Signed = {
    consumer: env.domain.verifyingContract,
    consumerChainId: Number(env.domain.chainId),
    signature: env.signature,
    attestation: {
      requestId: asHex(m.requestId),
      chainId: asBig(m.chainId),
      questionHash: asHex(m.questionHash),
      answerType: asAnswerType(m.answerType),
      answer: asHex(m.answer),
      figure: asBig(m.figure),
      fromBlock: asBig(m.fromBlock),
      toBlock: asBig(m.toBlock),
      blockHash: asHex(m.blockHash),
      panelJobId: asHex(m.panelJobId),
      panelSize: Number(m.panelSize),
      quorum: Number(m.quorum),
      agreed: Number(m.agreed),
      issuedAt: asBig(m.issuedAt),
      expiresAt: asBig(m.expiresAt),
    },
  };
  signed.attestation.answerType = await resolveAnswerType(signed);
  return signed;
}

/// The id of the newest attested request IMD lists, any consumer; null when none is listed.
export async function fetchLatestAttestedId(): Promise<string | null> {
  const res = await fetch(`${IMD_API}/oracle/requests?limit=25`, { cache: "no-store" });
  if (!res.ok) return null;
  const body = (await res.json()) as { requests?: { id: string; status: string }[] };
  return body.requests?.find((r) => r.status === "attested")?.id ?? null;
}

/// The same attestation with its answer raised by one, the signature untouched.
export function tamper(s: Signed): Signed {
  const next = (hexToBigInt(s.attestation.answer) + 1n).toString(16).padStart(64, "0");
  return { ...s, attestation: { ...s.attestation, answer: `0x${next}` } };
}

export const utc = (seconds: bigint) =>
  new Date(Number(seconds) * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
