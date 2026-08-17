/**
 * Page title validation — ADO wiki rules (docs/ADO-WIKI-FORMAT.md §2) plus the filesystem
 * constraints that apply because the wiki is a real folder on the user's disk.
 *
 * PURE MODULE — callers pass in everything it needs (sibling names, folder path).
 */
import {
  FORBIDDEN_TITLE_CHARS,
  MAX_FULL_PATH_CHARS,
  PATH_LENGTH_WARN_CHARS,
  WINDOWS_RESERVED_NAMES,
} from "../constants";
import { encodeTitleToFileName, hasAmbiguousEscape, stripMdExtension } from "./pageNameCodec";

export interface TitleValidationInput {
  /** Raw title as typed by the user (validated after trimming). */
  title: string;
  /** Vault-relative folder the page will live in; '' for the wiki root. */
  folderPath: string;
  /** File names (with .md) already present in that folder. */
  siblingFileNames: readonly string[];
  /** When renaming, the current file name so the page doesn't collide with itself. */
  currentFileName?: string;
}

export type IssueCode =
  | "empty"
  | "forbidden-character"
  | "control-character"
  | "leading-or-trailing-dot"
  | "reserved-name"
  | "duplicate"
  | "duplicate-case-insensitive"
  | "path-too-long"
  | "path-length-near-limit"
  | "ambiguous-escape";

export interface ValidationIssue {
  code: IssueCode;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  /** Trimmed title that should actually be used when ok. */
  title: string;
  /** Encoded file name (with .md) for the trimmed title. */
  fileName: string;
  /** Vault-relative path the page would occupy. */
  path: string;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export function validateTitle(input: TitleValidationInput): ValidationResult {
  const title = input.title.trim();
  const fileName = encodeTitleToFileName(title);
  const path = joinPath(input.folderPath, fileName);
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (title.length === 0) {
    errors.push({ code: "empty", message: "Enter a page title." });
    return { ok: false, title, fileName, path, errors, warnings };
  }

  for (const char of FORBIDDEN_TITLE_CHARS) {
    if (title.includes(char)) {
      errors.push({
        code: "forbidden-character",
        message: `A page title cannot contain ${FORBIDDEN_TITLE_CHARS.map((c) => `"${c}"`).join(", ")}.`,
      });
      break;
    }
  }

  if (hasControlOrSurrogate(title)) {
    errors.push({
      code: "control-character",
      message: "A page title cannot contain control or unpaired surrogate characters.",
    });
  }

  if (title.startsWith(".") || title.endsWith(".")) {
    errors.push({
      code: "leading-or-trailing-dot",
      message: 'A page title cannot start or end with "."',
    });
  }

  if (WINDOWS_RESERVED_NAMES.has(baseNameForReservedCheck(title))) {
    errors.push({
      code: "reserved-name",
      message: `"${title}" is a name Windows reserves and cannot be saved as a file.`,
    });
  }

  const siblings = input.siblingFileNames.filter((name) => name !== input.currentFileName);
  if (siblings.includes(fileName)) {
    errors.push({ code: "duplicate", message: `A page called "${title}" already exists here.` });
  } else {
    const lower = fileName.toLowerCase();
    const clash = siblings.find((name) => name.toLowerCase() === lower);
    if (clash) {
      errors.push({
        code: "duplicate-case-insensitive",
        message:
          `"${stripMdExtension(clash)}" differs from this title only in capitalization. ` +
          "Azure DevOps allows that, but Windows and macOS cannot store both files.",
      });
    }
  }

  if (path.length > MAX_FULL_PATH_CHARS) {
    errors.push({
      code: "path-too-long",
      message: `The page path is ${path.length} characters; Azure DevOps allows ${MAX_FULL_PATH_CHARS} including the repository URL.`,
    });
  } else if (path.length > PATH_LENGTH_WARN_CHARS) {
    warnings.push({
      code: "path-length-near-limit",
      message: `The page path is ${path.length} characters. Azure DevOps counts the repository URL toward its ${MAX_FULL_PATH_CHARS}-character limit, so keep it short.`,
    });
  }

  if (hasAmbiguousEscape(title)) {
    warnings.push({
      code: "ambiguous-escape",
      message:
        "This title contains a percent sign followed by an escape code (like %2D). " +
        "Azure DevOps stores it literally, so the page title may display differently.",
    });
  }

  return { ok: errors.length === 0, title, fileName, path, errors, warnings };
}

function hasControlOrSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
    // High surrogate must be followed by a low surrogate, and vice versa.
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) return true;
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function baseNameForReservedCheck(title: string): string {
  const dot = title.indexOf(".");
  return (dot === -1 ? title : title.slice(0, dot)).toUpperCase();
}

export function joinPath(folderPath: string, name: string): string {
  const folder = folderPath.replace(/^\/+|\/+$/g, "");
  return folder.length === 0 ? name : `${folder}/${name}`;
}
