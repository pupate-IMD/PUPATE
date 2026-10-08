"use client";

import { useEffect, useState } from "react";
import { hexToBigInt } from "viem";
import { fetchAttestation, fetchLatestAttestedId, ORACLE_SIGNER, SAMPLE, tamper, utc, verify, type Check, type Signed } from "@/lib/attestation";
import { Lead } from "./Hero";

const short = (hex: string) => `${hex.slice(0, 10)}…${hex.slice(-8)}`;

/// An oracle attestation laid open, with the checks FloorFeed makes on it run in the reader's own
/// browser. The sample is a real report IMD issued to another contract; any request id can be fetched
/// from IMD's API and checked the same way, and changing the answer by one shows the signature fail.
export function OracleProof() {
  const [source, setSource] = useState<{ signed: Signed; label: string }>({ signed: SAMPLE, label: "sample" });
  const [requestId, setRequestId] = useState("");
  const [altered, setAltered] = useState(false);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [busy, setBusy] = useState<"verify" | "fetch" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = altered ? tamper(source.signed) : source.signed;
  const a = shown.attestation;
  const passed = checks?.every((c) => c.pass) ?? false;

  async function run() {
    setBusy("verify");
    setChecks(await verify(shown));
    setBusy(null);
  }

  function toggle() {
    setAltered(!altered);
    setChecks(null);
  }

  async function load(id: string | null, label?: string) {
    setError(null);
    setBusy("fetch");
    try {
      const target = id ?? (await fetchLatestAttestedId());
      if (!target) throw new Error("IMD lists no attested request right now");
      const signed = await fetchAttestation(target);
      setSource({ signed, label: label ?? `request ${target.slice(0, 8)}…` });
      setRequestId(target);
      setAltered(false);
      setChecks(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // Once the keeper has reported from a real IMD attestation, the status feed names the request;
  // start from that one, so the panel checks Pupate's own report rather than the sample.
  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const res = await fetch("/status.json", { cache: "no-store" });
        if (!res.ok) return;
        const st = (await res.json()) as { feed?: { lastRequestId?: string | null } };
        const id = st.feed?.lastRequestId;
        if (on && typeof id === "string" && id) await load(id, `Pupate's latest report · ${id.slice(0, 8)}…`);
      } catch {
        // no feed, or no network: the sample stays
      }
    })();
    return () => {
      on = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="proof" id="proof">
      <h3 className="serif sub-h">Check the oracle yourself</h3>
      <p className="lede">
        The reference price is not this site&apos;s word. Each report is a message signed by the IMD oracle after a panel of
        seats agreed on the answer, and the checks below run in your browser, not on our server. Fetch any attestation
        straight from IMD&apos;s API by its request id, or start from the sample: a real report the oracle issued to another
        project&apos;s contract.
      </p>
      <div className="proof-grid">
        <div className="panel proof-sheet">
          <div className="label">
            Attestation · {source.label}
            {altered ? ", answer changed by one" : ""}
          </div>
          <Lead k="Answer" v={hexToBigInt(a.answer).toLocaleString("en-US")} note="uint256" />
          <Lead k="Panel" v={`${a.agreed} of ${a.panelSize} agreed`} note={`quorum ${a.quorum}`} />
          <Lead k="Evidence" v={`blocks ${a.fromBlock} to ${a.toBlock}`} note={`chain ${a.chainId}`} />
          <Lead k="Issued" v={utc(a.issuedAt)} />
          <Lead k="Expires" v={utc(a.expiresAt)} />
          <Lead k="Question" v={short(a.questionHash)} />
          <Lead k="Issued to" v={short(shown.consumer)} note={`the consuming contract, chain ${shown.consumerChainId}`} />
          <Lead k="Signature" v={short(shown.signature)} />
        </div>
        <div className="proof-run">
          <div className="proof-actions">
            <button className="btn primary" onClick={run} disabled={busy !== null}>
              {busy === "verify" ? "Checking…" : "Verify in this browser"} <span className="arrow">→</span>
            </button>
            <button className="btn" onClick={toggle} aria-pressed={altered} disabled={busy !== null}>
              {altered ? "Restore the answer" : "Change the answer by one"}
            </button>
          </div>
          <form
            className="proof-fetch"
            onSubmit={(e) => {
              e.preventDefault();
              void load(requestId.trim() || null);
            }}
          >
            <input
              className="num"
              value={requestId}
              onChange={(e) => setRequestId(e.target.value)}
              placeholder="IMD oracle request id"
              aria-label="IMD oracle request id"
              spellCheck={false}
            />
            <button className="btn" type="submit" disabled={busy !== null}>
              {busy === "fetch" ? "Fetching…" : requestId.trim() ? "Fetch from IMD" : "Fetch the latest"}
            </button>
          </form>
          {error ? <p className="dim" role="alert">{error}.</p> : null}
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
            On-chain, FloorFeed also checks that the report answers the pinned question for its own address and chain, is
            newer than the last one, and does not raise the price by more than 25% per 6 hours.
          </p>
        </div>
      </div>
    </div>
  );
}
