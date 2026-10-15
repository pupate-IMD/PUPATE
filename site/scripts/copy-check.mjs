// The copy check: the words the Metamorph surface never shows a visitor (the spec's "Copy and words"):
// series, target (outside "practice target"), anchor, prevWork, retarget, pot, convert, refresh, duties,
// with their plural and verb forms (and "conversion"). The surface is exactly the mine page, /cards and what
// renders them: components/{Mine,Incubator,PreRegister,Workspace,CardTile,CardView,Gallery,Leaderboard}.tsx,
// app/mine/** and app/cards/**, lib/metamorph/** and lib/miner/** (whose field notes and errors reach the
// page). The vault's own pages keep their words.
//
// Each file is parsed with the site's TypeScript, and what is read is what can reach the screen: JSX text,
// every string literal and every part of a template. Set aside: comments (not in the tree), imports, type
// names (a string in a type), property keys, ABI strings (human-readable signatures, the names handed to
// viem as functionName or eventName or with an abi, the event map whose keys are its values), target=
// attributes, and the GPU shader's source (a const named …WGSL). A hit prints file:line, the word and the
// string, and the check exits 1. Before the surface, a sample with known hits and known set-asides runs
// through the same reader, so a reader that sees nothing fails too.
//
//   cd site && npm run copy-check        (or: node scripts/copy-check.mjs)
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const SITE = join(dirname(fileURLToPath(import.meta.url)), "..");
const COMPONENTS = ["Mine", "Incubator", "PreRegister", "Workspace", "CardTile", "CardView", "Gallery", "Leaderboard"];
const TREES = ["app/mine", "app/cards", "lib/metamorph", "lib/miner"];

const FORBIDDEN = /\b(series|(?:re)?target(?:s|ed|ing)?|anchor(?:s|ed|ing)?|prevwork|pots?|convert(?:s|ed|ing|ers?)?|conversions?|refresh(?:es|ed|ing)?|duties)\b/gi;
const ALLOWED = /\bpractice target\b/gi;
const SIGNATURE = /^\s*(function|event|error|struct|constructor|fallback|receive)\s/;
const ABI_KEYS = new Set(["functionName", "eventName"]);

let failures = 0;

/// The name of a property, a variable or an attribute as written, when it is a plain name or a string.
function nameOf(n) {
  if (!n) return null;
  if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isPrivateIdentifier(n)) return n.text;
  if (ts.isJsxNamespacedName(n)) return `${n.namespace.text}:${n.name.text}`;
  return null;
}

/// Why a literal is not a rendered string, or null when it may be one. `node` is the literal itself (the
/// whole template for a template's parts).
function setAside(node) {
  const p = node.parent;
  // Imports and exports name modules: import x from "…", export … from "…", import("…"), require("…").
  if ((ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) && p.moduleSpecifier === node) return "import";
  if (ts.isExternalModuleReference(p)) return "import";
  if (ts.isCallExpression(p) && (p.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(p.expression) && p.expression.text === "require"))) return "import";
  // A string in a type is a type name: "anchor" | "prevWork" in a Pick, a union of literals.
  for (let a = p; a && !ts.isSourceFile(a); a = a.parent) {
    if (ts.isTypeNode(a)) return "type";
    if (ts.isBlock(a) || ts.isExpressionStatement(a)) break;
  }
  // Keys are names, not text: { "prevWork": … }, x["anchor"].
  if ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p)) && p.name === node) return "key";
  if (ts.isElementAccessExpression(p) && p.argumentExpression === node) return "key";
  if (ts.isComputedPropertyName(p)) return "key";
  // ABI strings.
  if (SIGNATURE.test(node.text ?? "")) return "abi";
  if (ts.isPropertyAssignment(p) && p.initializer === node) {
    const key = nameOf(p.name);
    if (key && ABI_KEYS.has(key)) return "abi";
    if (key === "name" && ts.isObjectLiteralExpression(p.parent) && p.parent.properties.some((q) => nameOf(q.name) === "abi")) return "abi";
    if (key !== null && key === node.text) return "abi";
  }
  // target="_blank" names a browsing context.
  if (ts.isJsxAttribute(p) && nameOf(p.name) === "target") return "target=";
  if (ts.isJsxExpression(p) && ts.isJsxAttribute(p.parent) && nameOf(p.parent.name) === "target") return "target=";
  // The GPU shader's source is a program, not copy (its comments are code comments).
  for (let a = p; a && !ts.isSourceFile(a); a = a.parent) {
    if (ts.isVariableDeclaration(a)) {
      const v = nameOf(a.name);
      if (v && /WGSL$/.test(v)) return "shader";
      break;
    }
  }
  return null;
}

/// Every string a file holds that could reach the screen, with what set the others aside.
function read(fileName, source) {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : fileName.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const hits = [];
  const asides = {};
  let strings = 0;
  const look = (node, parts) => {
    strings++;
    const why = setAside(node);
    if (why) {
      asides[why] = (asides[why] ?? 0) + 1;
      return;
    }
    for (const text of parts) {
      const words = text.replace(ALLOWED, "").match(FORBIDDEN);
      if (words) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        hits.push({ line, words: [...new Set(words.map((w) => w.toLowerCase()))], text: text.replace(/\s+/g, " ").trim() });
      }
    }
  };
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) look(node, [node.text]);
    else if (ts.isTemplateExpression(node)) look(node, [node.head.text, ...node.templateSpans.map((s) => s.literal.text)]);
    else if (ts.isJsxText(node) && node.text.trim()) look(node, [node.text]);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { hits, asides, strings };
}

// ------------------------------------------------------------------ the reader, on a sample

const SAMPLE = `"use client";
import Link from "next/link";
import { x } from "./target";
type Field = "anchor" | "prevWork";
const job: Pick<Job, "target"> = load();
const sigs = ["function prevWork() view returns (bytes32)", "event Retargeted(uint256 target)"];
const events = { Converted: "Converted" };
const shaderWGSL = \`// the target words\`;
read({ functionName: "pot" });
getAbiItem({ abi, name: "Converted" });
const o = { "refresh": 1 };
// a comment may say duties
export function Page() {
  const line = \`the pot is \${n} and the series grows\`;
  return (
    <p title="Refresh the page" data-x={"anchors away"}>
      The vault's duties wait. Your practice target is 20 bits.
      <a href="/x" target="_blank">x</a>
      {/* the anchor stays out of view */}
      {"we convert it"}
    </p>
  );
}
`;
{
  const r = read("sample.tsx", SAMPLE);
  const found = r.hits.flatMap((h) => h.words).sort().join(",");
  const want = ["anchors", "convert", "duties", "pot", "refresh", "series"].sort().join(",");
  const asides = Object.entries(r.asides).map(([k, v]) => `${k} ${v}`).join(", ");
  const ok =
    found === want && r.asides.import === 2 && r.asides.type === 3 && r.asides.abi === 5 && r.asides.key === 1 && r.asides.shader === 1 && r.asides["target="] === 1;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  the reader, on a sample: finds ${want.replace(/,/g, ", ")}; sets aside ${asides}${ok ? "" : `  (found ${found || "nothing"})`}`);
}

// ------------------------------------------------------------------ the surface

const files = [];
for (const c of COMPONENTS) {
  const f = join(SITE, "components", `${c}.tsx`);
  if (!existsSync(f)) {
    failures++;
    console.log(`FAIL  the surface names components/${c}.tsx, which does not exist`);
    continue;
  }
  files.push(f);
}
const walk = (dir) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|m?js)$/.test(e)) files.push(p);
  }
};
for (const t of TREES) {
  const d = join(SITE, t);
  if (!existsSync(d)) {
    failures++;
    console.log(`FAIL  the surface names ${t}/, which does not exist`);
    continue;
  }
  walk(d);
}

let strings = 0;
const asides = {};
const hits = [];
for (const f of files) {
  const r = read(f, readFileSync(f, "utf8"));
  strings += r.strings;
  for (const [k, v] of Object.entries(r.asides)) asides[k] = (asides[k] ?? 0) + v;
  for (const h of r.hits) hits.push({ file: relative(SITE, f).replace(/\\/g, "/"), ...h });
}
for (const h of hits) console.log(`FAIL  ${h.file}:${h.line}  ${h.words.join(", ")}  in ${JSON.stringify(h.text.length > 120 ? `${h.text.slice(0, 117)}...` : h.text)}`);
failures += hits.length;
const set = Object.entries(asides).map(([k, v]) => `${k} ${v}`).join(", ");
console.log(
  `${hits.length ? "FAIL" : "PASS"}  ${files.length} files of the Metamorph surface, ${strings} strings and texts read (set aside: ${set}): ` +
    `${hits.length ? `${hits.length} with a forbidden word` : 'no forbidden word ("practice target" allowed)'}`,
);
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
