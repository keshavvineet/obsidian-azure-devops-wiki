/**
 * What to do about a folder that Azure DevOps has no way to represent.  [PURE]
 *
 * An ADO wiki has no folders. `A/B/` exists only as the container for the subpages of `A/B.md`
 * (ADO-WIKI-FORMAT §1), and `.order` lists page names, never folder names. So a folder created on
 * its own — Obsidian's *New folder*, which is what a user reaches for when they want a section —
 * is invisible to the wiki: nothing lists it, no page owns it, and every page put inside it is
 * orphaned. That is the whole of "I create a new folder, add a page under it, and it does not
 * work": the page is unreachable and, if the folder name has a space in it, Publish is blocked by
 * the new-name gate.
 *
 * The repair is to make the folder into the thing the user meant — a page with subpages:
 * encode the folder's name, and create the paired `.md` beside it.
 *
 * The name goes through `portableName`, the same round trip a page's own name does, so a folder
 * and a page typed with the same characters can never end up spelled differently. That does mean a
 * typed hyphen is read as a space, because on disk the two are indistinguishable (§2: `-` is a
 * space, a literal hyphen is `%2D`); a title that really wants one is reachable through Rename.
 *
 * PURE MODULE — must not import from 'obsidian'.
 */
import { decodeFileName } from "../naming/pageNameCodec";
import { portableName } from "../naming/portableName";

export interface FolderPlan {
  /** Where the folder must end up — unchanged when its name is already ADO-portable. */
  folderPath: string;
  /** Whether that differs from where it is now, i.e. whether the folder has to be renamed. */
  renameFolder: boolean;
  /** Vault path of the paired page to create, always `${folderPath}.md`. */
  pagePath: string;
  /** The page title the user will see — the folder name they typed. */
  title: string;
  /** The folder name as it is on disk, for the notice. */
  folderName: string;
}

export interface FolderFacts {
  /** Whether a file already pairs with this folder, i.e. `${folderPath}.md` exists. */
  hasPairedPage: boolean;
}

/**
 * The repair for one folder, or null when there is nothing to do.
 *
 * Returns null for a folder that already pairs with a page (the normal, correct shape of every
 * subpage container in a wiki) and for anything under a dot-folder — `.attachments` and
 * `.obsidian` are not wiki content and must never grow a page.
 */
export function planFolderAdoption(folderPath: string, facts: FolderFacts): FolderPlan | null {
  const segments = folderPath.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) return null;
  // The wiki root itself is a folder with no page, and so is everything Obsidian hides.
  if (segments.some((segment) => segment.startsWith("."))) return null;
  if (facts.hasPairedPage) return null;

  const folderName = segments[segments.length - 1];
  const parent = segments.slice(0, -1).join("/");
  const portable = portableName(folderName, "folder") ?? folderName;
  const target = parent.length === 0 ? portable : `${parent}/${portable}`;

  return {
    folderPath: target,
    renameFolder: target !== folderPath,
    pagePath: `${target}.md`,
    title: decodeFileName(portable),
    folderName,
  };
}
