import type { Metadata } from "next";
import { Flow } from "@/components/Flow";
import { DocLink, Shell } from "@/components/Shell";

export const metadata: Metadata = { title: "Flow · Pupate" };

export default function Page() {
  return (
    <Shell>
      <Flow />
      <DocLink slug="mechanism" />
    </Shell>
  );
}
