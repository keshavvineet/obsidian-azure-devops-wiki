import { App, TFile, TFolder } from "obsidian";
import { around } from "../util/around";
import type { PageCommands } from "./pageCommands";

/**
 * Asks for the page title *before* anything is written, for Obsidian's own **New note** and
 * **New folder** (FR-1.2, round-7 report 2).
 *
 * Until now the plugin let Obsidian create `Untitled.md` or `Untitled/` and then repaired the
 * name afterwards — `pageNameGuard` renaming a fresh empty page, `folderGuard` turning a folder
 * into a page. That works, but it is a sequence of surprises: the user types a name into the
 * explorer's inline editor, and the plugin silently changes it a moment later. Worse, it leaves a
 * window in which a name Azure DevOps cannot open exists on disk, and a Publish inside that window
 * ships it to the portal where nobody can repair it. Asking first removes the window and the
 * surprise, and the two guards stay as the safety net for everything that does not come through
 * here (a git pull, another plugin, the file system).
 *
 * ## Why this wraps `FileManager` and not the commands
 *
 * Read out of `obsidian-1.13.6.asar` (standing rule 6) rather than guessed: **every** route to a
 * new note or folder funnels through `FileManager.createNewMarkdownFile` and
 * `FileManager.createNewFolder` — the file explorer's context menu, its header buttons, and the
 * `file-explorer:new-file` / `file-explorer:new-folder` global commands. Wrapping the two methods
 * covers all six entry points; wrapping the commands would miss the menus.
 *
 * ## Why these return a real file/folder and never null
 *
 * Also from the asar. Three of the four callers run the result through `afterCreate`, which begins
 * `return e ? … : [2]` and so tolerates null — but the global `file-explorer:new-folder` command
 * does `ensureSideLeaf(…, {state: {newFile: t.path}})` with **no** null check, and returning null
 * there would throw. So the wrappers always hand back the thing they really created.
 *
 * The visible consequence is that Obsidian then starts its own rename on it: an inline-title
 * rename for a file, which our decorator already makes read-only while it is decorated (Phase 7
 * note 4), and an inline row editor for a folder, which is pre-filled with the correct name and
 * goes away on Escape. Both are harmless because the name is already right by then.
 */
export class CreationInterceptor {
  constructor(
    private readonly app: App,
    private readonly pageCommands: PageCommands,
    /** Turning the plugin's page handling off must also give Obsidian's own dialogs back. */
    private readonly enabled: () => boolean,
  ) {}

  /**
   * @returns an uninstaller; the caller registers it so unload always restores Obsidian.
   *
   * Neither method is in the public typings, so neither is promised to exist. A missing one is
   * skipped rather than patched: `around` would throw on `undefined`, and because this runs in
   * `onload` that would take the **entire plugin** down — decorated titles, rendering, git and all
   * — over an optional convenience. Obsidian's own dialog is the fallback, which is exactly what
   * the `promptForPageName` setting turns back on anyway.
   */
  install(): () => void {
    const fileManager = this.app.fileManager as unknown as Partial<FileManagerInternals> | undefined;
    if (!fileManager) return () => undefined;

    const restores: Array<() => void> = [];
    const canPatch = (method: keyof FileManagerInternals): boolean => {
      if (typeof fileManager[method] === "function") return true;
      console.warn(`[azure-devops-wiki] FileManager.${method} is missing; not asking for a title`);
      return false;
    };

    if (canPatch("createNewMarkdownFile")) {
      restores.push(this.patchNewFile(fileManager as FileManagerInternals));
    }
    if (canPatch("createNewFolder")) {
      restores.push(this.patchNewFolder(fileManager as FileManagerInternals));
    }
    return () => {
      for (const restore of restores) restore();
    };
  }

  private patchNewFile(fileManager: FileManagerInternals): () => void {
    return around(fileManager, "createNewMarkdownFile", (original) => {
      return async (parent?: TFolder | null, name?: string, ...rest: unknown[]) => {
        // A caller that already knows the name is not the user pressing "New note" — it is
        // `createNewMarkdownFileFromLinktext` making the page behind a link. Leave it alone.
        //
        // "Knows the name" means a *non-empty* one. `file-explorer:new-file` goes through
        // `createAndOpenMarkdownFile("", "tab")`, which forwards that empty string as the name,
        // and Obsidian itself treats it as absent (`createNewFile` falls back to its Untitled
        // label on any falsy name). Testing `typeof name === "string"` alone therefore skipped
        // the prompt on the single most common route into it — the Ctrl+N the report was about.
        if (!this.enabled() || (typeof name === "string" && name.trim().length > 0)) {
          return original.call(fileManager, parent, name, ...rest);
        }
        const page = await this.promptForPage(folderPathOf(parent), false);
        return page ?? original.call(fileManager, parent, name, ...rest);
      };
    });
  }

  private patchNewFolder(fileManager: FileManagerInternals): () => void {
    return around(fileManager, "createNewFolder", (original) => {
      return async (parent?: TFolder | null, ...rest: unknown[]) => {
        if (!this.enabled()) return original.call(fileManager, parent, ...rest);

        const page = await this.promptForPage(folderPathOf(parent), true);
        // The caller asked for a folder and must be handed one, so a page whose paired folder
        // somehow did not appear falls back rather than returning a file in its place.
        const paired = page && this.app.vault.getAbstractFileByPath(stripMd(page.path));
        if (paired instanceof TFolder) return paired;
        return original.call(fileManager, parent, ...rest);
      };
    });
  }

  /**
   * Ask for a title and create the page, or null if the user cancelled or it failed.
   *
   * Both callers then fall back to Obsidian's own behaviour rather than returning null to it: the
   * caller has to be handed something (see the class comment), the two guards will name whatever
   * that produces, and someone who escapes out of a dialog they did not expect still gets the note
   * they asked for.
   */
  private promptForPage(folderPath: string, withSubpageFolder: boolean): Promise<TFile | null> {
    return this.pageCommands.createPageByPrompt(folderPath, withSubpageFolder);
  }
}

/**
 * The two methods this wraps are not in Obsidian's public typings, so they are declared here
 * rather than by weakening the plugin's types (CLAUDE.md: cast the stub-only surface).
 */
interface FileManagerInternals {
  createNewMarkdownFile: (
    parent?: TFolder | null,
    name?: string,
    ...rest: unknown[]
  ) => Promise<TFile | null>;
  createNewFolder: (parent?: TFolder | null, ...rest: unknown[]) => Promise<TFolder | null>;
}

function folderPathOf(parent?: TFolder | null): string {
  if (!parent || parent.isRoot()) return "";
  return parent.path;
}

function stripMd(path: string): string {
  return path.toLowerCase().endsWith(".md") ? path.slice(0, -3) : path;
}
