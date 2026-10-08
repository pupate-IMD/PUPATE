// Verifies an IMD oracle attestation from the command line with the same code the site runs in the
// browser: fetches it from api.imd.fun, recovers the signer, and runs FloorFeed's off-chain checks.
//
//   cd site && npx --yes tsx scripts/verify-attestation.ts [requestId]   (default: the latest attested)

import { fetchAttestation, fetchLatestAttestedId, ORACLE_SIGNER, recoverSigner, verify } from "../lib/attestation";

async function main(): Promise<number> {
  const id = process.argv[2] ?? (await fetchLatestAttestedId());
  if (!id) {
    console.error("IMD lists no attested request");
    return 1;
  }
  const signed = await fetchAttestation(id);
  const a = signed.attestation;
  console.log(`request ${id}`);
  console.log(`consumer ${signed.consumer} on chain ${signed.consumerChainId} · evidence chain ${a.chainId} · blocks ${a.fromBlock}-${a.toBlock}`);
  console.log(`answerType ${a.answerType} · answer ${a.answer} · panel ${a.agreed}/${a.quorum}/${a.panelSize} · issued ${a.issuedAt} · expires ${a.expiresAt}`);
  const signer = await recoverSigner(signed);
  const ok = signer.toLowerCase() === ORACLE_SIGNER.toLowerCase();
  console.log(`${ok ? "PASS" : "FAIL"}  recovered signer ${signer} ${ok ? "==" : "!="} IMD attester ${ORACLE_SIGNER}`);
  for (const c of await verify(signed)) console.log(`${c.pass ? "pass" : "fail"}  ${c.name}  (${c.detail})`);
  return ok ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
