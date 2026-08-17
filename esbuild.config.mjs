import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import fs from "fs";
import path from "path";

const prod = process.argv[2] === "production";

// Dev builds go straight into the test vault so Obsidian hot-reloads them.
const devOutDir = path.join("test-vault", ".obsidian", "plugins", "azure-devops-wiki");
const outfile = prod ? "main.js" : path.join(devOutDir, "main.js");

const copyAssets = () => {
  fs.copyFileSync("manifest.json", path.join(devOutDir, "manifest.json"));
  if (fs.existsSync("styles.css")) {
    fs.copyFileSync("styles.css", path.join(devOutDir, "styles.css"));
  }
};

if (!prod) {
  fs.mkdirSync(devOutDir, { recursive: true });
  copyAssets();
  // esbuild only watches what it bundles, so a CSS edit used to need the watcher restarting —
  // and stale styles are indistinguishable from a broken feature when testing by eye.
  for (const asset of ["styles.css", "manifest.json"]) {
    if (fs.existsSync(asset)) fs.watch(asset, { persistent: false }, () => copyAssets());
  }
}

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
    // Node builtins are imported with the explicit 'node:' prefix (src/git/gitService.ts);
    // builtin-modules only lists the bare names, so both spellings must be external.
    ...builtins.map((name) => `node:${name}`),
  ],
  format: "cjs",
  target: "es2021",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile,
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
