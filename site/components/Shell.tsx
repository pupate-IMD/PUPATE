import Link from "next/link";
import type { ReactNode } from "react";
import { Contracts } from "./Contracts";
import { DOCS, docHref } from "@/lib/docs";
import { InsideBar } from "./InsideBar";
import { TopBar } from "./TopBar";

/// The frame around every page. The front layer (home, how it works, work) is the bar, the page and
/// the footer. The technical layer adds the "Under the hood" strip: its own navigation and, before
/// launch, the note that every figure is a sample.
export function Shell({ children, layer = "front" }: { children: ReactNode; layer?: "front" | "inside" }) {
  return (
    <>
      <TopBar />
      {layer === "inside" ? <InsideBar /> : null}
      <main>{children}</main>
      <Contracts />
    </>
  );
}

/// The line under a page that points at the part of the documentation that explains it.
export function DocLink({ slug }: { slug: string }) {
  const page = DOCS.find((d) => d.slug === slug);
  if (!page) return null;
  return (
    <div className="wrap">
      <Link className="doclink" href={docHref(slug)}>
        <span className="label">In the docs</span>
        <span className="serif">{page.title} →</span>
        <span className="dim">{page.blurb}</span>
      </Link>
    </div>
  );
}
