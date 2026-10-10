import type { Metadata } from "next";
import { Buy } from "@/components/Buy";
import { Shell } from "@/components/Shell";

export const metadata: Metadata = { title: "Buy · Pupate" };

export default function Page() {
  return (
    <Shell>
      <Buy />
    </Shell>
  );
}
