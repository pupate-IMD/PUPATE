import Link from "next/link";
import type { ReactNode } from "react";
import { Contracts } from "./Contracts";
import { DOCS, docHref } from "@/lib/docs";
import { PreviewBar } from "./PreviewBar";
import { TopBar } from "./TopBar";

/// The frame around every page of the simulated protocol: the bar, the preview strip, the page
/// and the footer.
export function Shell({ children }: { children: ReactNode }) {
  return (
    <>
      <TopBar />
      <PreviewBar />
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
