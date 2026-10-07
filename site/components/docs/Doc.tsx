import Link from "next/link";
import type { ReactNode } from "react";
import { DOCS, docHref, docIndex } from "@/lib/docs";

/// One documentation page: its title from the table of contents, the body, and the way on.
export function Doc({ slug, children }: { slug: string; children: ReactNode }) {
  const i = docIndex(slug);
  const page = DOCS[i];
  const prev = i > 0 ? DOCS[i - 1] : null;
  const next = i < DOCS.length - 1 ? DOCS[i + 1] : null;
  return (
    <article className="doc">
      <header>
        <div className="label">
          Docs · {i + 1} of {DOCS.length}
        </div>
        <h1 className="serif">{page.title}</h1>
        <p className="dim">{page.blurb}</p>
      </header>
      <div className="prose">{children}</div>
      <nav className="pager" aria-label="Pages">
        {prev ? (
          <Link href={docHref(prev.slug)}>
            <span className="label">Previous</span>
            <span className="serif">← {prev.title}</span>
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link href={docHref(next.slug)} className="next">
            <span className="label">Next</span>
            <span className="serif">{next.title} →</span>
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </article>
  );
}

/// A note set apart from the text.
export function Aside({ children, tone }: { children: ReactNode; tone?: "gold" | "alarm" }) {
  return <div className={`doc-aside ${tone ?? ""}`}>{children}</div>;
}
