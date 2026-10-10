import type { Metadata } from "next";
import { Emerge } from "@/components/Emerge";
import { DocLink, Shell } from "@/components/Shell";

export const metadata: Metadata = { title: "Emerge · Pupate" };

export default function Page() {
  return (
    <Shell layer="inside">
      <Emerge />
      <DocLink slug="seats" />
    </Shell>
  );
}
