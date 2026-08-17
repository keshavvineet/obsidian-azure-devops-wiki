/**
 * Read-only audit of a real Azure DevOps wiki clone with the plugin's own pure modules.
 *
 *   npm run verify-wiki -- "C:\path\to\Project.wiki"
 *
 * Every phase's acceptance list includes "check this against a live wiki"; this is how that is
 * done without a scratch wiki to push to. It only reads, and reports what the plugin would have
 * to render: how many links resolve, which ADO block syntax occurs, and how many paragraphs hold
 * a table that Obsidian would show as text.
 */
import fs from "node:fs";
import path from "node:path";
import { findColonBlocks, normalizeAdoParagraph } from "../src/links/adoBlocks";
import { findMarkdownLinks, resolveHref, type PageLookup } from "../src/links/adoLinkResolver";
import { findRenderableBlocks } from "../src/links/documentBlocks";
import { findInlineTokens } from "../src/links/inlineAdo";
import { findWikilinks } from "../src/links/linkConverter";
import { findCodeRanges } from "../src/links/linkTargets";
import { decodeFileName, encodeTitle, stripMdExtension } from "../src/naming/pageNameCodec";

// Joined, not argv[2]: npm re-splits a quoted path on its spaces, and wiki clones live in
// folders like "2. Finance & Supply Chain Management".
const root = process.argv.slice(2).join(" ");
if (root.length === 0 || !fs.existsSync(root)) {
  console.error('Usage: npm run verify-wiki -- "C:\\path\\to\\Project.wiki"');
  process.exit(1);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.toLowerCase().endsWith(".md")) out.push(full);
  }
  return out;
}

const files = walk(root).map((full) => full.slice(root.length + 1).replace(/\\/g, "/"));
const byWikiPath = new Map<string, string>();
const byWikiPathLower = new Map<string, string>();
for (const file of files) {
  byWikiPath.set(`/${stripMdExtension(file)}`, file);
  byWikiPathLower.set(`/${stripMdExtension(file)}`.toLowerCase(), file);
}
const lookup: PageLookup = {
  forWikiPath(wikiPath) {
    const found = byWikiPath.get(wikiPath) ?? byWikiPathLower.get(wikiPath.toLowerCase());
    return found ? { file: { path: found } } : null;
  },
};

const attachmentDir = path.join(root, ".attachments");
const attachments = new Set(fs.existsSync(attachmentDir) ? fs.readdirSync(attachmentDir) : []);

const counts: Record<string, number> = {
  pages: files.length,
  attachmentsOnDisk: attachments.size,
  links: 0,
  linksToPages: 0,
  linksToAttachments: 0,
  linksExternal: 0,
  linksAnchorOnly: 0,
  linksUnresolved: 0,
  attachmentsMissingOnDisk: 0,
  rootAbsoluteImages: 0,
  toc: 0,
  tosp: 0,
  obsidianWikilinks: 0,
  workItems: 0,
  pullRequests: 0,
  mentions: 0,
  escapedReferences: 0,
  paragraphsNeedingTableRepair: 0,
  /** What live preview will now render as a block widget instead of showing as raw text. */
  livePreviewBlocks: 0,
  livePreviewTables: 0,
  namesRoundTripping: 0,
  namesNotRoundTripping: 0,
};
const colonBlocks: Record<string, number> = {};
const unresolvedSamples: string[] = [];
const tableSamples: string[] = [];
const nameSamples: string[] = [];

for (const file of files) {
  const name = stripMdExtension(file.split("/").pop() ?? file);
  if (encodeTitle(decodeFileName(name)) === name) counts.namesRoundTripping++;
  else {
    counts.namesNotRoundTripping++;
    if (nameSamples.length < 5) nameSamples.push(name);
  }

  const content = fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
  const fromFolder = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";

  for (const link of findMarkdownLinks(content)) {
    counts.links++;
    const resolution = resolveHref(link.href, { fromFolder, lookup });
    switch (resolution.kind) {
      case "page":
        counts.linksToPages++;
        break;
      case "attachment": {
        counts.linksToAttachments++;
        if (link.isImage) counts.rootAbsoluteImages++;
        const fileName = resolution.vaultPath.split("/").pop() ?? "";
        if (!attachments.has(fileName)) counts.attachmentsMissingOnDisk++;
        break;
      }
      case "external":
        counts.linksExternal++;
        break;
      case "anchor":
        counts.linksAnchorOnly++;
        break;
      case "missing":
        counts.linksUnresolved++;
        if (unresolvedSamples.length < 10) unresolvedSamples.push(`${file} → ${link.href}`);
        break;
    }
  }

  for (const block of findColonBlocks(content)) {
    const key = block.closed ? block.kind : `${block.kind} (unterminated)`;
    colonBlocks[key] = (colonBlocks[key] ?? 0) + 1;
  }

  counts.toc += (content.match(/\[\[_TOC_\]\]/g) ?? []).length;
  counts.tosp += (content.match(/\[\[_TOSP_\]\]/g) ?? []).length;
  counts.obsidianWikilinks += findWikilinks(content).filter(
    (link) => !/^_(TOC|TOSP)_$/.test(link.target),
  ).length;

  const inlineCodeRanges = findCodeRanges(content);
  for (const token of findInlineTokens(content)) {
    // A reference inside a code sample is a code sample, exactly as the renderers treat it.
    if (inlineCodeRanges.some(([from, to]) => token.start >= from && token.start < to)) continue;
    if (token.escaped) counts.escapedReferences++;
    else if (token.kind === "workItem") counts.workItems++;
    else if (token.kind === "pullRequest") counts.pullRequests++;
    else counts.mentions++;
  }

  for (const block of findRenderableBlocks(content.split("\n"))) {
    counts.livePreviewBlocks++;
    if (block.kind === "table") counts.livePreviewTables++;
  }

  for (const [paragraph, start] of paragraphsOf(content)) {
    if (normalizeAdoParagraph(paragraph) === null) continue;
    counts.paragraphsNeedingTableRepair++;
    if (tableSamples.length < 6) {
      tableSamples.push(`${file}:${lineOf(content, start)} → ${paragraph.split("\n")[0].slice(0, 62)}`);
    }
  }
}

/**
 * Paragraph blocks as Obsidian sections them: separated by blank lines, and *also* broken by a
 * heading or a fence, because those end a block on their own. Without that split, a table that
 * merely follows a heading looks like it needs repairing when it renders perfectly well.
 */
function paragraphsOf(content: string): Array<[string, number]> {
  const codeRanges = findCodeRanges(content);
  const blocks: Array<[string, number]> = [];

  let current: string[] = [];
  let start = 0;
  let offset = 0;
  const flush = (): void => {
    const text = current.join("\n");
    if (text.trim().length > 0) blocks.push([text, start]);
    current = [];
  };

  for (const line of content.split("\n")) {
    const isBoundary =
      line.trim().length === 0 ||
      /^ {0,3}#{1,6}\s/.test(line) ||
      /^ {0,3}(`{3,}|~{3,})/.test(line) ||
      codeRanges.some(([from, to]) => offset >= from && offset < to);
    if (isBoundary) {
      flush();
    } else {
      if (current.length === 0) start = offset;
      current.push(line);
    }
    offset += line.length + 1;
  }
  flush();
  return blocks;
}

function lineOf(content: string, offset: number): number {
  return content.slice(0, offset).split("\n").length;
}

console.log(`\n${path.basename(root)}\n${"=".repeat(path.basename(root).length)}`);
for (const [key, value] of Object.entries(counts)) console.log(`${key.padEnd(30)} ${value}`);
console.log("\n::: blocks:", Object.keys(colonBlocks).length === 0 ? "none" : colonBlocks);
if (unresolvedSamples.length > 0) console.log("\nunresolved links:\n ", unresolvedSamples.join("\n  "));
if (tableSamples.length > 0) console.log("\ntable repairs:\n ", tableSamples.join("\n  "));
if (nameSamples.length > 0) console.log("\nnames that do not round-trip:\n ", nameSamples.join("\n  "));
