/**
 * Every compatibility rule, in the order findings are reported within a file.
 *
 * The list is the linter's whole configuration: a rule is switched off by id in the settings,
 * and nothing else knows the set of rules exists.
 *
 * PURE MODULE — must not import from 'obsidian'.
 */
import type { LintRule } from "../types";
import { mermaidDialectRule, unterminatedBlockRule } from "./blocks";
import { calloutRule } from "./callouts";
import { commentRule, footnoteRule, highlightRule, tagRule } from "./inlineSyntax";
import { brokenLinkRule, relativeLinkRule } from "./links";
import { pageNameRule, pageSizeRule, pathLengthRule } from "./structure";
import { tableBlankLineRule, taskInTableRule } from "./tables";
import { wikilinkRule } from "./wikilinks";

export const ALL_RULES: readonly LintRule[] = [
  // The file itself first: a page ADO cannot open at all outranks anything inside it.
  pageNameRule,
  pathLengthRule,
  pageSizeRule,
  // Content that breaks or leaks.
  wikilinkRule,
  commentRule,
  brokenLinkRule,
  // Content that degrades.
  calloutRule,
  highlightRule,
  footnoteRule,
  tagRule,
  tableBlankLineRule,
  taskInTableRule,
  unterminatedBlockRule,
  mermaidDialectRule,
  // Cosmetic.
  relativeLinkRule,
];

export const RULE_IDS: readonly string[] = ALL_RULES.map((rule) => rule.id);
