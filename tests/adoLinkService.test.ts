import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { AdoLinkService } from "../src/links/adoLinkService";
import { convertWikilinks } from "../src/links/linkConverter";
import { PageIndex } from "../src/pages/pageIndex";
import { DEFAULT_SETTINGS } from "../src/settings";
import { FakeVault } from "./helpers/fakeVault";

/**
 * The index-backed half of link resolution: which wikilink targets become which ADO paths.
 * The cases here are the ones a real wiki actually contains — see the Phase 4 outcome in PLAN.md.
 */
function setup() {
  const vault = new FakeVault();
  vault.addPage("Home.md");
  vault.addPage("Product-Documentation.md");
  vault.addPage("Product-Documentation/25PI3_3.0-Setup-Data.md");
  vault.addPage("Product-Documentation/25PI3_3.3.1-Change-Lines-Display-%2D-Basic.md");
  vault.addPage("Product-Documentation/Overview.md");
  vault.addPage("Elsewhere/Overview.md");
  vault.writeOrder("", "Home", "Product-Documentation");

  const app = { vault, metadataCache: { getFileCache: () => null } } as unknown as App;
  const index = new PageIndex(app);
  const service = new AdoLinkService(app, index, () => DEFAULT_SETTINGS);
  return { app, index, service, vault };
}

describe("AdoLinkService.converterHost", () => {
  let harness: ReturnType<typeof setup>;

  beforeEach(async () => {
    harness = setup();
    await harness.index.rebuild();
  });

  const convert = (raw: string, sourcePath = "Home.md"): string =>
    convertWikilinks(raw, harness.service.converterHost(sourcePath)).content;

  it("resolves a wikilink written as a plain title", () => {
    expect(convert("[[25PI3_3.0 Setup Data]]")).toBe(
      "[25PI3_3.0 Setup Data](/Product-Documentation/25PI3_3.0-Setup-Data)",
    );
  });

  it("resolves a title containing a hyphen, which must not be decoded as a space", () => {
    // The bug this guards: decodeFileName('… Display - Basic') turns the hyphen back into a
    // space and matches nothing. Found in a production wiki (57 such wikilinks).
    expect(convert("[[25PI3_3.3.1 Change Lines Display - Basic]]")).toBe(
      "[25PI3_3.3.1 Change Lines Display - Basic]" +
        "(/Product-Documentation/25PI3_3.3.1-Change-Lines-Display-%2D-Basic)",
    );
  });

  it("resolves the encoded file name Obsidian's own autocomplete inserts", () => {
    expect(convert("[[Product-Documentation/25PI3_3.0-Setup-Data]]")).toBe(
      "[25PI3_3.0 Setup Data](/Product-Documentation/25PI3_3.0-Setup-Data)",
    );
  });

  it("prefers a same-folder page when a title is ambiguous", () => {
    expect(convert("[[Overview]]", "Elsewhere/Sibling.md")).toBe("[Overview](/Elsewhere/Overview)");
    expect(convert("[[Overview]]", "Product-Documentation/Sibling.md")).toBe(
      "[Overview](/Product-Documentation/Overview)",
    );
  });

  it("leaves a wikilink to a page that does not exist", () => {
    expect(convert("[[Not A Page]]")).toBe("[[Not A Page]]");
  });

  it("only embeds attachments that are already in .attachments", async () => {
    harness.vault.disk.set(".attachments/sample-1.png", "binary");
    await harness.service.reloadAttachments();

    expect(convert("![[sample-1.png]]")).toBe("![sample-1.png](/.attachments/sample-1.png)");
    expect(convert("![[not-there.png]]")).toBe("![[not-there.png]]");
  });
});

describe("AdoLinkService.resolve", () => {
  it("resolves ADO destinations against the index", async () => {
    const { index, service } = setup();
    await index.rebuild();

    expect(service.resolve("/Product-Documentation/Overview", "Home.md")).toMatchObject({
      kind: "page",
      vaultPath: "Product-Documentation/Overview.md",
    });
    expect(service.resolve("Overview.md", "Product-Documentation/Other.md")).toMatchObject({
      kind: "page",
      vaultPath: "Product-Documentation/Overview.md",
    });
    expect(service.resolve("/.attachments/x.png", "Home.md")).toMatchObject({
      kind: "attachment",
      vaultPath: ".attachments/x.png",
    });
    expect(service.resolve("/Gone", "Home.md")).toMatchObject({ kind: "missing" });
  });
});

describe("AdoLinkService.workItemHref", () => {
  it("needs the organization and project to build a link", async () => {
    const { app, index } = setup();
    const configured = new AdoLinkService(app, index, () => ({
      ...DEFAULT_SETTINGS,
      organizationUrl: "https://dev.azure.com/contoso",
      project: "Product Engineering",
    }));

    expect(configured.workItemHref("234825")).toBe(
      "https://dev.azure.com/contoso/Product%20Engineering/_workitems/edit/234825",
    );
    expect(new AdoLinkService(app, index, () => DEFAULT_SETTINGS).workItemHref("1")).toBeNull();
  });
});
