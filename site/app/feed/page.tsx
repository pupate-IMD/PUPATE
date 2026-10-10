import type { Metadata } from "next";
import { Feed } from "@/components/Feed";
import { Launch } from "@/components/Launch";
import { DocLink, Shell } from "@/components/Shell";

export const metadata: Metadata = { title: "Feed · Pupate" };

export default function Page() {
  return (
    <Shell layer="inside">
      <Launch />
      <Feed />
      <DocLink slug="oracle" />
    </Shell>
  );
}
