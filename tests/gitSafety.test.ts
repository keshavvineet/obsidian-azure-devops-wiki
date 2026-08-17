import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Standing guarantees about the git layer (NFR-3, PLAN Phase 3 acceptance), enforced by
 * reading the source rather than by hoping a reviewer notices.
 *
 * Two promises to the user: the plugin never runs a command that can discard their work, and
 * nothing they type can ever reach a shell.
 */
const GIT_DIR = join(__dirname, "..", "src", "git");

const sources = readdirSync(GIT_DIR)
  .filter((name) => name.endsWith(".ts"))
  .map((name) => ({ name, text: readFileSync(join(GIT_DIR, name), "utf8") }));

/** Quoted, so a word in prose or an identifier cannot trip these. */
const DESTRUCTIVE_ARGS = [
  '"reset"',
  '"clean"',
  '"--hard"',
  '"--force"',
  '"--force-with-lease"',
  '"filter-branch"',
  '"gc"',
  '"prune"',
];

describe("git safety rails", () => {
  it("has sources to check", () => {
    expect(sources.map((source) => source.name)).toContain("gitService.ts");
  });

  it.each(DESTRUCTIVE_ARGS)("never passes %s to git", (argument) => {
    for (const source of sources) {
      expect(`${source.name}: ${source.text.includes(argument)}`).toBe(`${source.name}: false`);
    }
  });

  it("spawns git only through execFile with an argument array", () => {
    for (const source of sources) {
      // exec/execSync/spawn with a string would put a shell between us and git.
      // The lookbehind keeps `pattern.exec(text)` — a regex match — out of it.
      expect(source.text).not.toMatch(/(?<![.\w])(exec|execSync|spawn|spawnSync|fork)\s*\(/);
      expect(source.text).not.toMatch(/shell\s*:\s*true/);
    }
  });

  it("passes user input as arguments, never interpolated into a command", () => {
    const service = sources.find((source) => source.name === "gitService.ts");
    expect(service).toBeDefined();
    // Every call site builds an array literal; a template literal would mean concatenation.
    expect(service?.text).not.toMatch(/execFile\s*\(\s*`/);
    expect(service?.text).toMatch(/execFile\(\s*this\.gitPath,\s*fullArgs,/);
  });

  it("only touches the working tree through git, never through fs writes", () => {
    for (const source of sources) {
      expect(source.text).not.toMatch(/writeFileSync|unlinkSync|rmSync|renameSync/);
    }
  });
});
