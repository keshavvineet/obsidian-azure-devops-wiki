import { describe, expect, it } from "vitest";
import { explorerLabel, rawExplorerLabel } from "../src/naming/displayTitle";

describe("rawExplorerLabel", () => {
  it("matches what Obsidian itself puts on the row", () => {
    // Obsidian hides the .md extension on files but shows folder names whole.
    expect(rawExplorerLabel("Pre%2DRelease-RCA-Categories.md", "file")).toBe(
      "Pre%2DRelease-RCA-Categories",
    );
    expect(rawExplorerLabel("Product-Documentation", "folder")).toBe("Product-Documentation");
    expect(rawExplorerLabel("Product-Documentation/1.-Setup.md", "file")).toBe("1.-Setup");
  });
});

describe("explorerLabel", () => {
  it("decodes page file names", () => {
    expect(explorerLabel("Pre%2DRelease-RCA-Categories.md", "file")).toBe(
      "Pre-Release RCA Categories",
    );
    expect(explorerLabel("Product-Documentation/4.-Design-%2D-Connectors.md", "file")).toBe(
      "4. Design - Connectors",
    );
  });

  it("decodes paired folders, which carry the same encoded name as their page", () => {
    expect(explorerLabel("Product-Documentation", "folder")).toBe("Product Documentation");
    expect(explorerLabel("Product-Documentation/4.-Design-%2D-Connectors", "folder")).toBe(
      "4. Design - Connectors",
    );
  });

  it("leaves rows alone when the name needs no decoding", () => {
    // Nothing to gain from touching the DOM, and nothing to restore on unload.
    expect(explorerLabel("Home.md", "file")).toBeNull();
    expect(explorerLabel("Scrum", "folder")).toBeNull();
  });

  it("leaves non-markdown files showing their real name", () => {
    // What the user sees must match what git will commit.
    expect(explorerLabel("notes-draft.txt", "file")).toBeNull();
    expect(explorerLabel("logo-final.png", "file")).toBeNull();
  });

  it("never touches hidden paths", () => {
    expect(explorerLabel(".attachments/my-image-abc.png", "file")).toBeNull();
    expect(explorerLabel(".attachments", "folder")).toBeNull();
    expect(explorerLabel(".obsidian/plugins/some-plugin", "folder")).toBeNull();
  });
});
