import { Cocoon } from "@/components/Cocoon";
import { Emerge } from "@/components/Emerge";
import { Feed } from "@/components/Feed";
import { FieldLog } from "@/components/FieldLog";
import { Hero } from "@/components/Hero";
import { Notes } from "@/components/Notes";
import { PreviewBar } from "@/components/PreviewBar";
import { SimProvider } from "@/components/SimContext";
import { Steps } from "@/components/Steps";
import { TopBar } from "@/components/TopBar";

export default function Page() {
  return (
    <SimProvider>
      <TopBar />
      <PreviewBar />
      <main>
        <Hero />
        <FieldLog />
        <Feed />
        <Cocoon />
        <Emerge />
        <Steps />
        <Notes />
        <footer className="wrap">
          <div className="serif">Pupate</div>
          <div>
            Contracts: to be deployed through the IMD launchpad. Token, hook, FloorFeed, Cocoon and the timelock will be listed
            here with verified source.
          </div>
          <div>Built with the IMD swarm, reviewed independently, hosted on IPFS. Source on GitHub.</div>
        </footer>
      </main>
    </SimProvider>
  );
}
