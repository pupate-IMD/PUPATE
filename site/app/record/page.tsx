import type { Metadata } from "next";
import { Record } from "@/components/Record";
import { DocLink, Shell } from "@/components/Shell";

export const metadata: Metadata = { title: "Record · Pupate" };

export default function Page() {
  return (
    <Shell>
      <Record />
      <DocLink slug="control" />
    </Shell>
  );
}
