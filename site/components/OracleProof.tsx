"use client";

import { useState } from "react";
import { hexToBigInt } from "viem";
import { ORACLE_SIGNER, SAMPLE, tamper, utc, verify, type Check } from "@/lib/attestation";
import { Lead } from "./Hero";

const short = (hex: string) => `${hex.slice(0, 10)}…${hex.slice(-8)}`;

/// An oracle attestation laid open, with the checks FloorFeed makes on it run in the reader's own
/// browser. Changing the answer by one shows the signature check failing.
export function OracleProof() {
  const [altered, setAltered] = useState(false);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = altered ? tamper(SAMPLE) : SAMPLE;
  const a = shown.attestation;
  const passed = checks?.every((c) => c.pass) ?? false;

  async function run() {
    setBusy(true);
    setChecks(await verify(shown));
    setBusy(false);
  }

  function toggle() {
    setAltered(!altered);
    setChecks(null);
  }

  return (
    <div className="proof" id="proof">
      <h3 className="serif sub-h">Check the oracle yourself</h3>
      <p className="lede">
        The reference price is not this site&apos;s word. Each report is a message signed by the IMD oracle after a panel of
        seats agreed on the answer, and the checks below run in your browser, not on our server. Until FloorFeed is
        deployed, the report shown is a real one the oracle issued to another project&apos;s contract.
      </p>
      <div className="proof-grid">
        <div className="panel proof-sheet">
          <div className="label">Attestation{altered ? ", answer changed by one" : ""}</div>
          <Lead k="Answer" v={hexToBigInt(a.answer).toLocaleString("en-US")} note="uint256" />
          <Lead k="Panel" v={`${a.agreed} of ${a.panelSize} agreed`} note={`quorum ${a.quorum}`} />
          <Lead k="Evidence" v={`blocks ${a.fromBlock} to ${a.toBlock}`} note={`chain ${a.chainId}`} />
          <Lead k="Issued" v={utc(a.issuedAt)} />
          <Lead k="Expires" v={utc(a.expiresAt)} />
          <Lead k="Question" v={short(a.questionHash)} />
          <Lead k="Issued to" v={short(shown.consumer)} note="the consuming contract" />
          <Lead k="Signature" v={short(shown.signature)} />
        </div>
        <div className="proof-run">
          <div className="proof-actions">
            <button className="btn primary" onClick={run} disabled={busy}>
              Verify in this browser <span className="arrow">→</span>
            </button>
            <button className="btn" onClick={toggle} aria-pressed={altered}>
              {altered ? "Restore the answer" : "Change the answer by one"}
            </button>
          </div>
          {checks === null ? (
            <p className="dim">
              Expected signer: <span className="num">{ORACLE_SIGNER}</span>. Run the checks, then change the answer and run
              them again.
            </p>
          ) : (
            <>
              <div className={`verdict ${passed ? "ok" : "bad"}`} role="status">
                <span className="mark" aria-hidden="true">
                  {passed ? "✓" : "×"}
                </span>
                {passed ? "Every check passes." : "A check failed: FloorFeed refuses a report like this."}
              </div>
              <ul className="checks">
                {checks.map((c) => (
                  <li key={c.name} className={c.pass ? "ok" : "bad"}>
                    <span className="mark" aria-hidden="true">
                      {c.pass ? "✓" : "×"}
                    </span>
                    <span>
                      {c.name}
                      <span className="dim num"> · {c.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="dim" style={{ fontSize: 11 }}>
            On-chain, FloorFeed also checks that the report answers the pinned question, is newer than the last one, and
            does not raise the price by more than 25% per 6 hours.
          </p>
        </div>
      </div>
    </div>
  );
}
