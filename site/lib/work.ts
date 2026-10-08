// Proof of work: what the seats actually do in the IMD swarm. IMD's per-seat records are large (a
// busy seat's is megabytes) and its seat and job endpoints do not allow browser reads, so the keeper
// fetches them, condenses them and publishes /work.json next to /status.json. The site only reads
// that file. The schema below is the contract between the two.

import { useQuery } from "@tanstack/react-query";

export interface WorkJob {
  jobId: string;
  /// The job's objective, cut to a sentence or two.
  objective: string;
  role: string;
  /// accepted | rejected | failed | pending, as IMD reports the submission.
  status: string;
  jobState: string;
  nodeKey?: string;
  submittedAt?: string;
  acceptedAt?: string | null;
}

export interface SeatWorkRecord {
  tokenId: number;
  agentId?: string;
  /// False when IMD knows no device for the seat; the counts are then zero.
  paired: boolean;
  status?: string;
  online?: boolean;
  pairedAt?: string;
  runtime?: { id: string; version?: string; model?: string; effort?: string } | null;
  devices?: number;
  counts: { attempts: number; accepted: number; rejected: number; failed: number; pending: number };
  reviewsTotal?: number;
  workTotal?: number;
  /// Newest first, at most a dozen.
  recent: WorkJob[];
  collaborators: { tokenId: number; sharedJobs: number }[];
  /// Held by the vault (as opposed to a featured example).
  held: boolean;
  fetchedAt: string;
  error?: string;
}

export interface WorkFeed {
  schema: "pupate-work/1";
  generatedAt: string;
  chainId?: number;
  vault?: string;
  held: number[];
  featured: number[];
  seats: SeatWorkRecord[];
}

export const explorerAgent = (tokenId: number) => `https://explorer.imd.fun/agents/${tokenId}`;
export const explorerJob = (jobId: string) => `https://explorer.imd.fun/jobs/${jobId}`;

export function acceptanceRate(c: SeatWorkRecord["counts"]): number | null {
  const judged = c.accepted + c.rejected + c.failed;
  return judged ? c.accepted / judged : null;
}

/// The published feed, or null when the keeper has not written one (preview without a keeper).
export function useWorkFeed(): { feed: WorkFeed | null; loading: boolean } {
  const q = useQuery({
    queryKey: ["work-feed"],
    queryFn: async () => {
      const res = await fetch("/work.json", { cache: "no-store" });
      if (!res.ok) return null;
      const feed = (await res.json()) as WorkFeed;
      return feed?.schema === "pupate-work/1" ? feed : null;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 0,
  });
  return { feed: q.data ?? null, loading: q.isLoading };
}

export const ago = (iso: string | undefined | null, now = Date.now()): string => {
  if (!iso) return "—";
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
