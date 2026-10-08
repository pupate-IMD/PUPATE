import type { Metadata } from "next";
import { DocLink, Shell } from "@/components/Shell";
import { Work } from "@/components/Work";

export const metadata: Metadata = { title: "Proof of work · Pupate" };

export default function Page() {
  return (
    <Shell>
      <Work />
      <DocLink slug="seats" />
    </Shell>
  );
}
