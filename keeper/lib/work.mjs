// The work feed: IMD's own record of what each seat has done, condensed and published as work.json
// next to status.json. IMD's seat records are large (megabytes for a busy seat) and its seat and job
// endpoints do not allow browser reads, so the keeper reads them here and the site reads the file.
// Schema "pupate-work/1" is shared with site/lib/work.ts.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { log, warn } from './log.mjs';
import { writeJsonAtomic } from './status.mjs';

const RECENT = 12;
const COLLABORATORS = 5;
const OBJECTIVE_CHARS = 160;
const zeroCounts = () => ({ attempts: 0, accepted: 0, rejected: 0, failed: 0, pending: 0 });

const firstLine = (s) => {
  const line = String(s ?? '').split('\n').find((l) => l.trim()) ?? '';
  return line.length > OBJECTIVE_CHARS ? `${line.slice(0, OBJECTIVE_CHARS - 1)}…` : line;
};
const when = (w) => Date.parse(w.acceptedAt || w.submittedAt || 0) || 0;

/** Fetch one seat's record from IMD and condense it. A seat IMD knows no device for is `paired: false`. */
export async function fetchSeatRecord(api, tokenId, { held = false, timeoutMs = 30_000 } = {}) {
  const fetchedAt = new Date().toISOString();
  const res = await fetch(`${api}/seats/${tokenId}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (res.status === 404) {
    return { tokenId, paired: false, counts: zeroCounts(), recent: [], collaborators: [], held, fetchedAt };
  }
  if (!res.ok) throw new Error(`IMD answered ${res.status} for seat ${tokenId}`);
  const r = await res.json();
  const rt = Array.isArray(r.runtimes) && r.runtimes[0] ? r.runtimes[0] : null;
  const work = Array.isArray(r.work) ? r.work : [];
  const recent = [...work]
    .sort((a, b) => when(b) - when(a))
    .slice(0, RECENT)
    .map((w) => ({
      jobId: String(w.jobId),
      objective: firstLine(w.objective),
      role: String(w.role ?? ''),
      status: String(w.status ?? ''),
      jobState: String(w.jobState ?? ''),
      nodeKey: w.nodeKey ? String(w.nodeKey) : undefined,
      submittedAt: w.submittedAt ?? undefined,
      acceptedAt: w.acceptedAt ?? null,
    }));
  const collaborators = (Array.isArray(r.collaborators) ? r.collaborators : [])
    .map((c) => ({ tokenId: Number(c.tokenId), sharedJobs: Number(c.sharedJobs ?? 0) }))
    .filter((c) => Number.isFinite(c.tokenId))
    .sort((a, b) => b.sharedJobs - a.sharedJobs)
    .slice(0, COLLABORATORS);
  return {
    tokenId,
    agentId: r.agentId !== undefined ? String(r.agentId) : undefined,
    paired: true,
    status: r.status ? String(r.status) : undefined,
    online: Boolean(r.online),
    pairedAt: r.pairedAt ?? undefined,
    runtime: rt ? { id: String(rt.id ?? ''), version: rt.version, model: rt.premiumModel?.model, effort: rt.premiumModel?.effort } : null,
    devices: Number.isFinite(Number(r.devices)) ? Number(r.devices) : undefined,
    counts: {
      attempts: Number(r.attempts ?? 0),
      accepted: Number(r.accepted ?? 0),
      rejected: Number(r.rejected ?? 0),
      failed: Number(r.failed ?? 0),
      pending: Number(r.pending ?? 0),
    },
    reviewsTotal: Array.isArray(r.reviews) ? r.reviews.length : undefined,
    workTotal: work.length,
    recent,
    collaborators,
    held,
    fetchedAt,
  };
}

/**
 * Publish work.json for the seats the vault holds plus WORK_SEATS. IMD's records are heavy, so the
 * feed is refreshed at most every WORK_EVERY seconds unless the set of seats changed or the file is
 * missing. Returns the path when written, null otherwise; per-seat failures land in the record.
 */
export async function writeWorkFile(ctx, s) {
  const { cfg, cache } = ctx;
  if (!cfg.statusDir) return null;
  const file = join(cfg.statusDir, 'work.json');
  const heldIds = (s.seats || []).filter((x) => x.held && !x.gone && !x.filled).map((x) => Number(x.tokenId));
  const featured = cfg.workSeats.filter((id) => !heldIds.includes(id));
  const ids = [...heldIds, ...featured];
  const key = ids.join(',');
  const now = Date.now();
  const fresh = cache.work && cache.work.key === key && now - Date.parse(cache.work.at) < cfg.workEverySec * 1000;
  if (fresh && existsSync(file)) return null;

  const seats = [];
  for (const id of ids) {
    const held = heldIds.includes(id);
    try {
      seats.push(await fetchSeatRecord(cfg.imdApi, id, { held }));
    } catch (e) {
      warn(`work feed: seat ${id}: ${e.message}`);
      seats.push({ tokenId: id, paired: false, counts: zeroCounts(), recent: [], collaborators: [], held, fetchedAt: new Date().toISOString(), error: e.message });
    }
  }
  const feed = {
    schema: 'pupate-work/1',
    generatedAt: new Date(now).toISOString(),
    chainId: cfg.chainId,
    vault: cfg.addresses.cocoon,
    held: heldIds,
    featured,
    seats,
  };
  await writeJsonAtomic(file, feed);
  cache.work = { key, at: new Date(now).toISOString() };
  const paired = seats.filter((x) => x.paired).length;
  log(`work feed: ${seats.length} seat${seats.length === 1 ? '' : 's'} (${paired} paired) -> ${file}`);
  return file;
}
