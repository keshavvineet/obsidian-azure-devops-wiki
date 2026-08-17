/**
 * Rules about the *file*, not its markdown: names Azure DevOps cannot map back to a page title,
 * paths past the 235-character limit, and pages past the 18 MB one (FR-1.5, FR-8.3).
 *
 * The name rule exists because of a real failure: a page created in Obsidian appeared in the ADO
 * tree but refused to open with "the page's title or any of its ancestor page's title does not
 * conform to Wiki standards". A name that does not round-trip through the codec — a literal
 * space, a raw `:` — produces exactly that, and the ancestor wording means the offending name can
 * be a folder several levels up, which is why every segment of the path is checked, not just the
 * file's own name.
 *
 * PURE MODULE — must not import from 'obsidian'.
 */
import { MAX_FULL_PATH_CHARS, MAX_PAGE_FILE_BYTES, PATH_LENGTH_WARN_CHARS } from "../../constants";
import { nonPortableSegments } from "../../naming/portableName";
import type { LintDocument, LintFinding, LintRule } from "../types";

export const pageNameRule: LintRule = {
  id: "page-name-not-portable",
  description: "File names Azure DevOps cannot turn back into a page title",

  run(doc: LintDocument): LintFinding[] {
    // The round-trip test itself lives in naming/portableName, which the create/rename guard
    // uses too — one definition of "a name Azure DevOps can load", checked in both places.
    return nonPortableSegments(doc.path).map((problem) => ({
      rule: pageNameRule.id,
      severity: "error",
      message: problem.isPage
        ? `"${problem.name}" is not a name Azure DevOps can decode into a page title.`
        : `The folder "${problem.name}" in this page's path is not a name Azure DevOps can ` +
          "decode, so this page and every page under it fail to open in the wiki.",
      path: doc.path,
      from: 0,
      to: 0,
      line: 0,
      advice:
        `Rename it to "${problem.suggestion}". ` +
        (problem.isPage
          ? 'Use the "Rename wiki page" command so .order and inbound links follow.'
          : "Rename the parent page — its folder is renamed with it."),
    }));
  },
};

export const pathLengthRule: LintRule = {
  id: "page-path-too-long",
  description: "Page paths at or past Azure DevOps' 235-character limit",

  run(doc: LintDocument): LintFinding[] {
    const length = doc.path.length;
    if (length <= PATH_LENGTH_WARN_CHARS) return [];

    const overLimit = length > MAX_FULL_PATH_CHARS;
    return [
      {
        rule: pathLengthRule.id,
        severity: overLimit ? "error" : "warn",
        message: overLimit
          ? `This page's path is ${length} characters; Azure DevOps allows ${MAX_FULL_PATH_CHARS}.`
          : `This page's path is ${length} characters, close to Azure DevOps' ${MAX_FULL_PATH_CHARS}-character limit.`,
        path: doc.path,
        from: 0,
        to: 0,
        line: 0,
        advice:
          "Azure DevOps counts the repository URL toward the limit, so the real headroom is " +
          "smaller than it looks. Shorten a page title along the path.",
      },
    ];
  },
};

export const pageSizeRule: LintRule = {
  id: "page-too-large",
  description: "Pages past Azure DevOps' 18 MB file limit",

  run(doc: LintDocument): LintFinding[] {
    if (doc.sizeBytes <= MAX_PAGE_FILE_BYTES) return [];
    return [
      {
        rule: pageSizeRule.id,
        severity: "error",
        message: `This page is ${megabytes(doc.sizeBytes)} MB; Azure DevOps refuses to render past ${megabytes(MAX_PAGE_FILE_BYTES)} MB.`,
        path: doc.path,
        from: 0,
        to: 0,
        line: 0,
        advice: "Split it into subpages.",
      },
    ];
  },
};

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}
