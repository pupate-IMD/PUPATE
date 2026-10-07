import type { Metadata } from "next";
import { DocLink, Shell } from "@/components/Shell";
import { Steps } from "@/components/Steps";

export const metadata: Metadata = { title: "Steps · Pupate" };

export default function Page() {
  return (
    <Shell>
      <Steps />
      <DocLink slug="steps" />
    </Shell>
  );
}
