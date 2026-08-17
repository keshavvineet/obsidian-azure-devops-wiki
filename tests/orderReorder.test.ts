import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { OrderManager } from "../src/order/orderManager";
import { PageIndex } from "../src/pages/pageIndex";
import { fakeApp, FakeVault } from "./helpers/fakeVault";

/**
 * Reordering from the wiki tree (FR-2.3) and setting the home page (FR-2.4).
 *
 * Both write .order *after* reconciliation, which is what makes them work on folders whose
 * .order file is missing or out of date — the case the drag UX would otherwise silently
 * swallow.
 */
let vault: FakeVault;
let index: PageIndex;
let orderManager: OrderManager;

beforeEach(async () => {
  vault = new FakeVault();
  vault.addPage("Home.md");
  vault.addPage("Pre%2DRelease-RCA-Categories.md");
  vault.addPage("Product-Documentation.md");
  vault.addPage("Product-Documentation/1.-Setup.md");
  vault.addPage("Product-Documentation/4.-Design-%2D-Connectors.md");
  vault.writeOrder("", "Home", "Pre%2DRelease-RCA-Categories", "Product-Documentation");
  vault.writeOrder("Product-Documentation", "1.-Setup", "4.-Design-%2D-Connectors");

  const app = fakeApp(vault) as unknown as App;
  index = new PageIndex(app);
  orderManager = new OrderManager(app, index);
  await index.rebuild();
  vault.writeCount = 0;
});

describe("OrderManager.reorder", () => {
  it("writes the sequence the caller arranged", async () => {
    await orderManager.reorder("Product-Documentation", [
      "4.-Design-%2D-Connectors",
      "1.-Setup",
    ]);

    expect(vault.orderEntries("Product-Documentation")).toEqual([
      "4.-Design-%2D-Connectors",
      "1.-Setup",
    ]);
  });

  it("updates the index so the tree redraws in the new sequence", async () => {
    await orderManager.reorder("", [
      "Product-Documentation",
      "Home",
      "Pre%2DRelease-RCA-Categories",
    ]);

    expect(index.rootPages().map((entry) => entry.name)).toEqual([
      "Product-Documentation",
      "Home",
      "Pre%2DRelease-RCA-Categories",
    ]);
  });

  it("writes nothing when the sequence is already correct", async () => {
    await orderManager.reorder("", ["Home", "Pre%2DRelease-RCA-Categories", "Product-Documentation"]);
    expect(vault.writeCount).toBe(0);
  });

  it("works for a folder that has no .order file yet", async () => {
    // Azure DevOps sorts such a folder alphabetically; the drag is a real change, so this is
    // the moment to capture the sequence in a file.
    vault.addPage("Scrum.md");
    vault.addPage("Scrum/DoD.md");
    vault.addPage("Scrum/Ceremonies.md");
    await index.rebuild();

    await orderManager.reorder("Scrum", ["DoD", "Ceremonies"]);

    expect(vault.orderEntries("Scrum")).toEqual(["DoD", "Ceremonies"]);
  });

  it("picks up pages that .order had not caught up with yet", async () => {
    vault.addPage("Product-Documentation/9.-Appendix.md");
    await index.rebuild();

    // The tree shows the un-listed page last; dragging it to the front must stick.
    await orderManager.reorder("Product-Documentation", [
      "9.-Appendix",
      "1.-Setup",
      "4.-Design-%2D-Connectors",
    ]);

    expect(vault.orderEntries("Product-Documentation")).toEqual([
      "9.-Appendix",
      "1.-Setup",
      "4.-Design-%2D-Connectors",
    ]);
  });

  it("drops stale entries while reordering, like any other .order write", async () => {
    vault.writeOrder("Product-Documentation", "1.-Setup", "Deleted-Page", "4.-Design-%2D-Connectors");
    await index.rebuild();

    await orderManager.reorder("Product-Documentation", [
      "4.-Design-%2D-Connectors",
      "1.-Setup",
    ]);

    expect(vault.orderEntries("Product-Documentation")).toEqual([
      "4.-Design-%2D-Connectors",
      "1.-Setup",
    ]);
  });
});

describe("OrderManager.setFirst", () => {
  it("promotes a page to the wiki home page position", async () => {
    await orderManager.setFirst("", "Product-Documentation");
    expect(vault.orderEntries("")).toEqual([
      "Product-Documentation",
      "Home",
      "Pre%2DRelease-RCA-Categories",
    ]);
  });

  it("writes nothing when the page is already the home page", async () => {
    await orderManager.setFirst("", "Home");
    expect(vault.writeCount).toBe(0);
  });

  it("promotes a page that .order did not list yet", async () => {
    vault.addPage("Welcome.md");
    await index.rebuild();

    await orderManager.setFirst("", "Welcome");

    expect(vault.orderEntries("")[0]).toBe("Welcome");
  });
});
