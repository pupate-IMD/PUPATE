"use client";

import { useEffect, useRef, useState } from "react";

/// Text that flashes briefly when its value changes, so a figure that moved is easy to spot.
export function Flash({ children }: { children: string }) {
  const prev = useRef(children);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (prev.current === children) return;
    prev.current = children;
    setOn(true);
    const t = setTimeout(() => setOn(false), 900);
    return () => clearTimeout(t);
  }, [children]);
  return <span className={on ? "flash" : undefined}>{children}</span>;
}
