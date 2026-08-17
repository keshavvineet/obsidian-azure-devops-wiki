import { describe, expect, it } from "vitest";
import { planFolderAdoption } from "../src/pages/folderPlan";

const orphan = { hasPairedPage: false };
const paired = { hasPairedPage: true };

describe("planFolderAdoption", () => {
  it("turns a bare folder at the root into a page, encoding the name", () => {
    const plan = planFolderAdoption("This is a new page", orphan);

    expect(plan).toEqual({
      folderPath: "This-is-a-new-page",
      renameFolder: true,
      pagePath: "This-is-a-new-page.md",
      title: "This is a new page",
      folderName: "This is a new page",
    });
  });

  it("creates the paired page without renaming a folder that is already portable", () => {
    const plan = planFolderAdoption("Research", orphan);

    expect(plan?.renameFolder).toBe(false);
    expect(plan?.folderPath).toBe("Research");
    expect(plan?.pagePath).toBe("Research.md");
    expect(plan?.title).toBe("Research");
  });

  it("leaves a folder that already pairs with a page alone", () => {
    // The normal shape of every subpage container in a wiki — nothing to repair.
    expect(planFolderAdoption("Product-Documentation", paired)).toBeNull();
  });

  it("keeps the parent path and only repairs the last segment", () => {
    const plan = planFolderAdoption("Product-Documentation/Release notes", orphan);

    expect(plan?.folderPath).toBe("Product-Documentation/Release-notes");
    expect(plan?.pagePath).toBe("Product-Documentation/Release-notes.md");
    expect(plan?.title).toBe("Release notes");
  });

  it("never touches a dot folder — .attachments and .obsidian are not wiki content", () => {
    expect(planFolderAdoption(".attachments", orphan)).toBeNull();
    expect(planFolderAdoption(".obsidian", orphan)).toBeNull();
    expect(planFolderAdoption(".obsidian/plugins", orphan)).toBeNull();
    // Also when the dot segment is a parent of an otherwise ordinary name.
    expect(planFolderAdoption(".trash/Some folder", orphan)).toBeNull();
  });

  it("has nothing to say about the wiki root", () => {
    expect(planFolderAdoption("", orphan)).toBeNull();
    expect(planFolderAdoption("/", orphan)).toBeNull();
  });

  it("reads a typed hyphen as a space, exactly as a page name is read", () => {
    // The codec has no way to tell "Pre-Release" (literal hyphen, stored Pre%2DRelease) from
    // "Pre Release" (stored Pre-Release) once it is on disk, and resolves it the same way
    // renameToPortableName does for a page — so creating a folder and creating a page with the
    // same name cannot disagree. A literal hyphen is reachable through Rename.
    const plan = planFolderAdoption("Pre-Release notes", orphan);

    expect(plan?.folderPath).toBe("Pre-Release-notes");
    expect(plan?.title).toBe("Pre Release notes");
  });

  it("encodes the characters Azure DevOps escapes in a folder name", () => {
    const plan = planFolderAdoption("FAQ: getting started?", orphan);

    expect(plan?.folderPath).toBe("FAQ%3A-getting-started%3F");
    expect(plan?.title).toBe("FAQ: getting started?");
  });
});
