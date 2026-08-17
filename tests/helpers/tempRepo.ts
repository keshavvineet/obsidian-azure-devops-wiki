import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Real git repositories in a temp directory — the only honest way to test the git layer.
 *
 * Shape: a bare `origin` (stand-in for Azure DevOps) with two clones, `alice` (the plugin's
 * vault) and `bob` (someone editing in the ADO web UI). No network is involved.
 */

export const WIKI_BRANCH = "wikiMain";

export function gitAvailable(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export interface WikiFixture {
  root: string;
  origin: string;
  alice: string;
  bob: string;
  git(repo: string, ...args: string[]): string;
  write(repo: string, relativePath: string, content: string): void;
  read(repo: string, relativePath: string): string;
  commitAll(repo: string, message: string): void;
  /** Commit and push in one step — how the "someone else edited it" side behaves. */
  publish(repo: string, relativePath: string, content: string, message: string): void;
  originContent(relativePath: string): string;
  cleanup(): void;
}

export function createWikiFixture(): WikiFixture {
  const root = mkdtempSync(join(tmpdir(), "adowiki-git-"));
  const origin = join(root, "origin.git");
  const alice = join(root, "alice");
  const bob = join(root, "bob");

  const git = (repo: string, ...args: string[]): string =>
    execFileSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      // Keep the fixture independent of whatever the developer has in ~/.gitconfig.
      env: { ...process.env, GIT_CONFIG_GLOBAL: join(root, "nonexistent.gitconfig"), GIT_CONFIG_SYSTEM: "" },
    });

  mkdirSync(origin, { recursive: true });
  git(origin, "init", "--bare", "--quiet");
  git(origin, "symbolic-ref", "HEAD", `refs/heads/${WIKI_BRANCH}`);

  mkdirSync(alice, { recursive: true });
  git(alice, "init", "--quiet");
  configure(git, alice);
  git(alice, "checkout", "-q", "-b", WIKI_BRANCH);
  writeFileSync(join(alice, "Home.md"), "# Home\n\nWelcome to the wiki.\n");
  writeFileSync(join(alice, ".order"), "Home\n");
  git(alice, "add", "-A");
  git(alice, "commit", "-q", "-m", "initial wiki");
  git(alice, "remote", "add", "origin", origin);
  git(alice, "push", "-q", "-u", "origin", WIKI_BRANCH);

  git(root, "clone", "--quiet", origin, bob);
  configure(git, bob);

  const write = (repo: string, relativePath: string, content: string): void => {
    const full = join(repo, relativePath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  };

  const commitAll = (repo: string, message: string): void => {
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", message);
  };

  return {
    root,
    origin,
    alice,
    bob,
    git,
    write,
    read: (repo, relativePath) => readFileSync(join(repo, relativePath), "utf8"),
    commitAll,
    publish: (repo, relativePath, content, message) => {
      write(repo, relativePath, content);
      commitAll(repo, message);
      git(repo, "push", "-q");
    },
    originContent: (relativePath) => git(origin, "show", `${WIKI_BRANCH}:${relativePath}`),
    cleanup: () => {
      try {
        rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        // A leftover temp directory is not worth failing a test over (Windows file locks).
      }
    },
  };
}

function configure(git: (repo: string, ...args: string[]) => string, repo: string): void {
  git(repo, "config", "user.name", "Test User");
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "commit.gpgsign", "false");
  // Line-ending translation would make every conflict test platform-dependent.
  git(repo, "config", "core.autocrlf", "false");
}
