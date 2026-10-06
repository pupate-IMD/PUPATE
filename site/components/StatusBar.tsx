"use client";

import { eth, int, mode } from "@/lib/sim";
import { useDispatch, useSim } from "./SimContext";

export function StatusBar() {
  const s = useSim();
  const dispatch = useDispatch();
  return (
    <>
      {s.toast && (
        <div className="toast num" role="status" aria-live="polite" onClick={() => dispatch({ type: "dismissToast" })}>
          {s.toast.text}
        </div>
      )}
      <div className="statusbar">
        <div className="wrap">
          <span className="num">{s.seats.length} seats held</span>
          <span className="num">{eth(s.taxCollected, 1)} taxed</span>
          <span className="num">{int(s.burned)} burned</span>
          <span>mode {mode(s).name.toLowerCase()}</span>
          <span className="health">preview</span>
        </div>
      </div>
    </>
  );
}
