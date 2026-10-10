import type { Metadata } from "next";
import { Suspense } from "react";
import { SeatSheet } from "@/components/SeatSheet";
import { DocLink, Shell } from "@/components/Shell";

export const metadata: Metadata = { title: "Seat · Pupate" };

export default function SeatPage() {
  return (
    <Shell layer="inside">
      <Suspense fallback={<div className="wrap section dim">Loading the sheet…</div>}>
        <SeatSheet />
      </Suspense>
      <DocLink slug="seats" />
    </Shell>
  );
}
