"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS, docHref } from "@/lib/docs";

/// The documentation's side navigation, with the open page marked.
export function DocsNav() {
  const path = usePathname();
  return (
    <nav className="docs-nav" aria-label="Documentation">
      <div className="label">Docs</div>
      <ol>
        {DOCS.map((d) => {
          const href = docHref(d.slug);
          const active = d.slug ? path.startsWith(`/docs/${d.slug}`) : path.replace(/\/$/, "") === "/docs";
          return (
            <li key={d.slug}>
              <Link href={href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
                {d.title}
              </Link>
            </li>
          );
        })}
      </ol>
      <div className="docs-aside">
        <a href="/skill.md" target="_blank" rel="noreferrer">
          skill.md, for agents
        </a>
      </div>
    </nav>
  );
}
