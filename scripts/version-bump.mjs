/**
 * Keeps manifest.json and versions.json in step with package.json.
 *
 * Run automatically by `npm version` (the "version" lifecycle script), which then includes
 * both files in the version commit — so a tag can never point at a manifest saying something
 * else, which is what the release workflow refuses to build.
 */
import fs from "fs";

const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
manifest.version = version;
fs.writeFileSync("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);

// versions.json maps every released plugin version to the minimum Obsidian it needs, so an
// older Obsidian is offered the newest plugin release it can actually run.
const versions = JSON.parse(fs.readFileSync("versions.json", "utf8"));
versions[version] = manifest.minAppVersion;
fs.writeFileSync("versions.json", `${JSON.stringify(versions, null, 2)}\n`);

console.log(`Set version ${version} (needs Obsidian ${manifest.minAppVersion}).`);
