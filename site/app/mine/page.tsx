import type { Metadata } from "next";
import { Mine } from "@/components/Mine";
import { Shell } from "@/components/Shell";

export const metadata: Metadata = { title: "Mine · Pupate" };

export default function Page() {
  return (
    <Shell>
      <Mine />
    </Shell>
  );
}
