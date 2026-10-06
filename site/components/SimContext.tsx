"use client";

import { createContext, useContext, useEffect, useReducer, type Dispatch, type ReactNode } from "react";
import { preset, reduce, type Action, type SimState } from "@/lib/sim";

const StateContext = createContext<SimState | null>(null);
const DispatchContext = createContext<Dispatch<Action> | null>(null);

export function SimProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reduce, "steady", preset);

  // The burn's five-block spacing, one block every 1.2 seconds in the preview.
  useEffect(() => {
    if (state.burnCooldown === 0) return;
    const t = setTimeout(() => dispatch({ type: "burnTick" }), 1200);
    return () => clearTimeout(t);
  }, [state.burnCooldown]);

  useEffect(() => {
    if (!state.toast) return;
    const t = setTimeout(() => dispatch({ type: "dismissToast" }), 4200);
    return () => clearTimeout(t);
  }, [state.toast]);

  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>{children}</DispatchContext.Provider>
    </StateContext.Provider>
  );
}

export function useSim(): SimState {
  const s = useContext(StateContext);
  if (!s) throw new Error("useSim outside SimProvider");
  return s;
}

export function useDispatch(): Dispatch<Action> {
  const d = useContext(DispatchContext);
  if (!d) throw new Error("useDispatch outside SimProvider");
  return d;
}
