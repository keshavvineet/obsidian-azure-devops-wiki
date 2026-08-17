/**
 * Copies the built plugin into an Obsidian vault.
 *
 *   npm run install-plugin -- "C:\path\to\your\vault"
 *
 * Run `npm run build` first. Re-run this after every build, then use Obsidian's
 * "Reload app without saving" (Ctrl+R) to pick up the new code.
 */
import fs from "fs";
import path from "path";

const PLUGIN_ID = "azure-devops-wiki";
const FILES = ["main.js", "manifest.json", "styles.css"];

const vaultPath = process.argv[2];
if (!vaultPath) {
  console.error('Usage: npm run install-plugin -- "C:\\path\\to\\vault"');
  process.exit(1);
}

if (!fs.existsSync(vaultPath) || !fs.statSync(vaultPath).isDirectory()) {
  console.error(`Not a folder: ${vaultPath}`);
  process.exit(1);
}

const missing = FILES.filter((file) => !fs.existsSync(file));
if (missing.length > 0) {
  console.error(`Missing build output: ${missing.join(", ")}. Run "npm run build" first.`);
  process.exit(1);
}

const target = path.join(vaultPath, ".obsidian", "plugins", PLUGIN_ID);
fs.mkdirSync(target, { recursive: true });
for (const file of FILES) {
  fs.copyFileSync(file, path.join(target, file));
}

console.log(`Installed ${PLUGIN_ID} to ${target}`);

// Opening a wiki clone as a vault drops .obsidian/ into the repo. Committing it to the
// wiki would publish the plugin config as wiki content, so flag it early.
const gitDir = path.join(vaultPath, ".git");
const gitignorePath = path.join(vaultPath, ".gitignore");
if (fs.existsSync(gitDir)) {
  const gitignore = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf8") : "";
  if (!/^\s*\.obsidian\/?\s*$/m.test(gitignore)) {
    console.warn(
      "\nWARNING: this vault is a git repository and its .gitignore does not list .obsidian/.\n" +
        "Add this line to .gitignore before committing, or Obsidian's config becomes wiki content:\n" +
        "    .obsidian/",
    );
  }
}
