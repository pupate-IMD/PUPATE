import type { Metadata } from "next";
import { RunVault } from "@/components/RunVault";
import { Shell } from "@/components/Shell";

export const metadata: Metadata = {
  title: "Run the vault · Pupate",
  description: "The vault's duties from live chain state: which are ready now, what each pays, and who ran them last. Anyone can run them.",
};

export default function Page() {
  return (
    <Shell>
      <RunVault />
    </Shell>
  );
}
