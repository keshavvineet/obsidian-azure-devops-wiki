/**
 * Inline Azure DevOps references that are plain text to Obsidian (FR-4.4, FR-4.5):
 * work items `#123`, pull requests `!123`, mentions `@<guid-or-alias>`.
 *
 * `#123` is deliberately *not* an Obsidian tag (a digits-only tag is invalid), so decorating it
 * cannot fight the tag system.
 *
 * PURE MODULE — must not import from 'obsidian'.
 */

export type InlineTokenKind = "workItem" | "pullRequest" | "mention";

export interface InlineToken {
  kind: InlineTokenKind;
  /** Offset of the '#', '!' or '@' in the searched text. */
  start: number;
  /** Offset just past the token. */
  end: number;
  /** Work-item/PR id, or the mention's guid/alias. */
  id: string;
  /** The token exactly as written. */
  text: string;
  /** True when the reference is escaped (`\#123`) and must stay literal. */
  escaped: boolean;
}

export interface InlineTokenOptions {
  workItems?: boolean;
  pullRequests?: boolean;
  mentions?: boolean;
}

/**
 * `#123`, `!123` and `@<…>`, with a preceding backslash captured rather than ignored so callers
 * can keep an escaped reference literal. A reference must not follow a word character, which is
 * what keeps `page#123` (a URL fragment) and `Wow!123` out.
 */
const INLINE_PATTERN = /(\\?)(?:([#!])(\d+)|@<([^<>\n]{1,200})>)/g;
const WORD_BEFORE = /[\w%]/;

export function findInlineTokens(text: string, options: InlineTokenOptions = {}): InlineToken[] {
  const want = {
    workItems: options.workItems ?? true,
    pullRequests: options.pullRequests ?? true,
    mentions: options.mentions ?? true,
  };

  const tokens: InlineToken[] = [];
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const [whole, backslash, sigil, digits, mention] = match;
    const matchStart = match.index ?? 0;
    const start = matchStart + backslash.length;

    // '%23' is an encoded hash, and 'abc#1' is a fragment — neither is a reference.
    const before = text[start - 1];
    if (before !== undefined && backslash.length === 0 && WORD_BEFORE.test(before)) continue;

    const kind: InlineTokenKind =
      mention !== undefined ? "mention" : sigil === "#" ? "workItem" : "pullRequest";
    if (kind === "workItem" && !want.workItems) continue;
    if (kind === "pullRequest" && !want.pullRequests) continue;
    if (kind === "mention" && !want.mentions) continue;

    tokens.push({
      kind,
      start,
      end: matchStart + whole.length,
      id: mention ?? digits,
      text: whole.slice(backslash.length),
      escaped: backslash.length === 1,
    });
  }
  return tokens;
}

/** Ids whose reference is escaped somewhere in the text, so they must stay literal. */
export function escapedIds(text: string, options: InlineTokenOptions = {}): Set<string> {
  const ids = new Set<string>();
  for (const token of findInlineTokens(text, options)) {
    if (token.escaped) ids.add(`${token.kind}:${token.id}`);
  }
  return ids;
}

export function workItemUrl(organizationUrl: string, project: string, id: string): string | null {
  const org = organizationUrl.trim().replace(/\/+$/, "");
  if (org.length === 0 || project.trim().length === 0) return null;
  return `${org}/${encodeURIComponent(project.trim())}/_workitems/edit/${encodeURIComponent(id)}`;
}

export function pullRequestUrl(
  organizationUrl: string,
  project: string,
  id: string,
): string | null {
  const org = organizationUrl.trim().replace(/\/+$/, "");
  if (org.length === 0 || project.trim().length === 0) return null;
  // Azure DevOps resolves a pull-request id without knowing the repository.
  return `${org}/${encodeURIComponent(project.trim())}/_git/pullrequest/${encodeURIComponent(id)}`;
}

/** '3b0a2131-0000-4000-8000-000000000000' → '@3b0a2131…', an alias → '@alias'. */
export function mentionLabel(id: string): string {
  const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  return guid ? `@${id.slice(0, 8)}…` : `@${id}`;
}
