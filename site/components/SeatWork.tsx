"use client";

import { pad4, pct } from "@/lib/sim";
import { acceptanceRate, ago, explorerAgent, explorerJob, type SeatWorkRecord } from "@/lib/work";
import { Lead } from "./Hero";

/// One seat's proof of work, from IMD's own record of it: whether it is paired and online, what runs
/// it, how much it has done and how often that was accepted, and its latest jobs with links to the
/// explorer where each can be checked.
export function SeatWorkCard({ rec, compact = false }: { rec: SeatWorkRecord; compact?: boolean }) {
  const rate = acceptanceRate(rec.counts);
  const chip = !rec.paired ? "not paired" : rec.online ? "online" : "offline";
  const chipClass = !rec.paired ? "" : rec.online ? "jade" : "";
  return (
    <article className="panel work-card">
      <div className="work-head">
        <div>
          <a className="serif id" href={explorerAgent(rec.tokenId)} target="_blank" rel="noreferrer">
            Seat {pad4(rec.tokenId)}
          </a>
          <div className="dim" style={{ fontSize: 11 }}>
            {rec.held ? "held by the vault" : "featured"}
            {rec.runtime?.model ? ` · ${rec.runtime.id}, ${rec.runtime.model}${rec.runtime.effort ? ` (${rec.runtime.effort})` : ""}` : ""}
            {rec.pairedAt ? ` · paired ${ago(rec.pairedAt)}` : ""}
          </div>
        </div>
        <span className={`chip ${chipClass}`}>
          <i className="d" aria-hidden="true" />
          {chip}
        </span>
      </div>

      {rec.error ? (
        <p className="dim">{rec.error}</p>
      ) : !rec.paired ? (
        <p className="dim">IMD knows no device for this seat, so it has done no work yet. The operator pairs one with <span className="num">authorizeWorker</span>.</p>
      ) : (
        <>
          <div className="rows">
            <Lead k="Accepted" v={rec.counts.accepted.toLocaleString("en-US")} note={rate !== null ? `${pct(rate)} of judged work` : undefined} />
            <Lead k="Rejected · failed" v={`${rec.counts.rejected} · ${rec.counts.failed}`} />
            <Lead k="Pending" v={String(rec.counts.pending)} />
            {rec.reviewsTotal !== undefined && <Lead k="Reviews given" v={rec.reviewsTotal.toLocaleString("en-US")} />}
            {rec.collaborators.length > 0 && (
              <Lead
                k="Worked with"
                v={rec.collaborators
                  .slice(0, compact ? 2 : 4)
                  .map((c) => `${pad4(c.tokenId)} ×${c.sharedJobs}`)
                  .join(", ")}
              />
            )}
          </div>
          {rec.recent.length > 0 && (
            <div className="tablewrap work-table">
              <table>
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Role</th>
                    <th>Result</th>
                    <th className="num">When</th>
                  </tr>
                </thead>
                <tbody>
                  {rec.recent.slice(0, compact ? 4 : 10).map((j) => (
                    <tr key={`${j.jobId}-${j.nodeKey ?? ""}-${j.submittedAt ?? ""}`}>
                      <td>
                        <a href={explorerJob(j.jobId)} target="_blank" rel="noreferrer" title={j.objective}>
                          {j.objective.length > 72 ? `${j.objective.slice(0, 72)}…` : j.objective || j.jobId.slice(0, 8)}
                        </a>
                      </td>
                      <td className="dim">{j.role}</td>
                      <td>
                        <span className={`chip ${j.status === "accepted" ? "jade" : j.status === "pending" ? "" : "gold"}`}>{j.status}</span>
                      </td>
                      <td className="num dim">{ago(j.acceptedAt ?? j.submittedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <div className="dim" style={{ fontSize: 11 }}>
        From IMD&apos;s record of the seat, read {ago(rec.fetchedAt)} ·{" "}
        <a className="jade" href={explorerAgent(rec.tokenId)} target="_blank" rel="noreferrer">
          agent #{rec.tokenId} on the explorer ↗
        </a>
      </div>
    </article>
  );
}
