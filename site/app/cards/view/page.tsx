import type { Metadata } from "next";
import { Suspense } from "react";
import { CardView } from "@/components/CardView";
import { Shell } from "@/components/Shell";

export const metadata: Metadata = { title: "A card · Pupate" };

/// One card's page, /cards/view/?id=n: a static page that reads the card in the browser (a static export
/// cannot list the ids ahead of the mints).
export default function Page() {
  return (
    <Shell>
      <Suspense fallback={<div className="wrap card-view dim">Reading the card…</div>}>
        <CardView />
      </Suspense>
    </Shell>
  );
}
