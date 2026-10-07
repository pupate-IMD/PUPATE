import { FieldLog } from "@/components/FieldLog";
import { Hero } from "@/components/Hero";
import { Launch } from "@/components/Launch";
import { Notes } from "@/components/Notes";
import { Shell } from "@/components/Shell";
import { Stages } from "@/components/Stages";

export default function Page() {
  return (
    <Shell>
      <Launch />
      <Hero />
      <FieldLog />
      <Stages />
      <Notes />
    </Shell>
  );
}
