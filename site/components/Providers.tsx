"use client";

import type { ReactNode } from "react";
import { SimProvider, useDispatch, useSim } from "./SimContext";
import { Web3Provider } from "./Web3Provider";

function Toast() {
  const s = useSim();
  const dispatch = useDispatch();
  if (!s.toast) return null;
  return (
    <div className="toast num" role="status" aria-live="polite" onClick={() => dispatch({ type: "dismissToast" })}>
      {s.toast.text}
    </div>
  );
}

/// Lives in the root layout, so the wallet and the simulated protocol survive moving between pages.
export function Providers({ children }: { children: ReactNode }) {
  return (
    <Web3Provider>
      <SimProvider>
        {children}
        <Toast />
      </SimProvider>
    </Web3Provider>
  );
}
