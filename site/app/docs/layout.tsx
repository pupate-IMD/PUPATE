import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Contracts } from "@/components/Contracts";
import { DocsNav } from "@/components/docs/DocsNav";
import { InsideBar } from "@/components/InsideBar";
import { TopBar } from "@/components/TopBar";

export const metadata: Metadata = {
  title: { default: "Docs · Pupate", template: "%s · Pupate docs" },
};

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <TopBar />
      <InsideBar />
      <main className="wrap docs">
        <DocsNav />
        {children}
      </main>
      <Contracts />
    </>
  );
}
