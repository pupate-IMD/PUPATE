import type { Metadata } from "next";
import { Gallery } from "@/components/Gallery";
import { Leaderboard } from "@/components/Leaderboard";
import { Shell } from "@/components/Shell";
import { Workspace } from "@/components/Workspace";

export const metadata: Metadata = { title: "Your cards · Pupate" };

/// The workspace: the visitor's cards first (or a connect prompt), then every card minted, then the miners.
export default function Page() {
  return (
    <Shell>
      <Workspace />
      <Gallery />
      <Leaderboard />
    </Shell>
  );
}
