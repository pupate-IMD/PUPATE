import { Suspense } from "react";
import { Contracts } from "@/components/Contracts";
import { PreviewBar } from "@/components/PreviewBar";
import { SeatSheet } from "@/components/SeatSheet";
import { TopBar } from "@/components/TopBar";

export default function SeatPage() {
  return (
    <>
      <TopBar />
      <PreviewBar />
      <main>
        <Suspense fallback={<div className="wrap section dim">Loading the sheet…</div>}>
          <SeatSheet />
        </Suspense>
        <Contracts />
      </main>
    </>
  );
}
