import type { Metadata } from "next";
import { Inside } from "@/components/Inside";
import { Shell } from "@/components/Shell";

export const metadata: Metadata = { title: "Under the hood · Pupate" };

export default function Page() {
  return (
    <Shell layer="inside">
      <Inside />
    </Shell>
  );
}
