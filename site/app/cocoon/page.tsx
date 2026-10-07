import type { Metadata } from "next";
import { Cocoon } from "@/components/Cocoon";
import { DocLink, Shell } from "@/components/Shell";

export const metadata: Metadata = { title: "Cocoon · Pupate" };

export default function Page() {
  return (
    <Shell>
      <Cocoon />
      <DocLink slug="seats" />
    </Shell>
  );
}
