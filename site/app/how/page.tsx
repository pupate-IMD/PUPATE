import type { Metadata } from "next";
import { How } from "@/components/How";
import { Shell } from "@/components/Shell";

export const metadata: Metadata = { title: "How it works · Pupate" };

export default function Page() {
  return (
    <Shell>
      <How />
    </Shell>
  );
}
