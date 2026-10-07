// The documentation's table of contents. Each entry is one page under /docs.

export interface DocPage {
  slug: string;
  title: string;
  blurb: string;
}

export const DOCS: DocPage[] = [
  { slug: "", title: "Overview", blurb: "What Pupate is, in one page." },
  { slug: "mechanism", title: "How it works", blurb: "The tax, the split, the modes and the burn." },
  { slug: "seats", title: "Seats", blurb: "How the vault buys, lists, pairs and sells Identity MD seats." },
  { slug: "oracle", title: "The reference price", blurb: "IMD oracle attestations and the checks FloorFeed makes." },
  { slug: "steps", title: "Running the steps", blurb: "The public functions, their conditions and their rewards." },
  { slug: "parameters", title: "Parameters", blurb: "Every number, its default and the bounds it can move within." },
  { slug: "control", title: "Control and risks", blurb: "Who can change what, what nobody can change, and what can go wrong." },
  { slug: "launch", title: "Launch and contracts", blurb: "The IMD launch, the deployment order and the addresses." },
];

export const docHref = (slug: string) => (slug ? `/docs/${slug}/` : "/docs/");

export function docIndex(slug: string): number {
  return DOCS.findIndex((d) => d.slug === slug);
}
