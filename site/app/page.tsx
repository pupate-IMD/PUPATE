import { Cocoon } from "@/components/Cocoon";
import { Contracts } from "@/components/Contracts";
import { Emerge } from "@/components/Emerge";
import { Feed } from "@/components/Feed";
import { FieldLog } from "@/components/FieldLog";
import { Flow } from "@/components/Flow";
import { Hero } from "@/components/Hero";
import { Launch } from "@/components/Launch";
import { Notes } from "@/components/Notes";
import { PreviewBar } from "@/components/PreviewBar";
import { Record } from "@/components/Record";
import { Steps } from "@/components/Steps";
import { TopBar } from "@/components/TopBar";

export default function Page() {
  return (
    <>
      <TopBar />
      <PreviewBar />
      <main>
        <Launch />
        <Hero />
        <FieldLog />
        <Flow />
        <Feed />
        <Cocoon />
        <Emerge />
        <Steps />
        <Record />
        <Notes />
        <Contracts />
      </main>
    </>
  );
}
