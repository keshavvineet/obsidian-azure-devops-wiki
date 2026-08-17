import { describe, expect, it } from "vitest";
import {
  emptyOrderFile,
  parseOrderFile,
  reconcileOrder,
  serializeOrderFile,
  withEntriesArranged,
  withEntryAppended,
  withEntryFirst,
  withEntryMoved,
  withEntryRemoved,
  withEntryRenamed,
} from "../src/order/orderFile";

// The real root .order from the AXBIS wiki.
const PRODUCTION_ORDER = [
  "Change-architectural-design-involving-Web-Service-Handlers",
  "Pre%2DRelease-RCA-Categories",
  "Environments-List",
  "Scrum",
  "Product-Documentation",
  "Work-Item-Analysis-Documents",
].join("\n");

describe("parseOrderFile", () => {
  it("parses a production .order file", () => {
    const order = parseOrderFile(PRODUCTION_ORDER + "\n");
    expect(order.entries).toHaveLength(6);
    expect(order.entries[1]).toBe("Pre%2DRelease-RCA-Categories");
    expect(order.eol).toBe("\n");
    expect(order.trailingNewline).toBe(true);
  });

  it("detects CRLF, blank lines, stray whitespace and a BOM", () => {
    const order = parseOrderFile("﻿One\r\n\r\n  Two  \r\nThree");
    expect(order.entries).toEqual(["One", "Two", "Three"]);
    expect(order.eol).toBe("\r\n");
    expect(order.trailingNewline).toBe(false);
  });

  it("treats an empty file as an empty list", () => {
    expect(parseOrderFile("").entries).toEqual([]);
  });
});

describe("serializeOrderFile", () => {
  it("round-trips a production file byte-for-byte", () => {
    const raw = PRODUCTION_ORDER + "\n";
    expect(serializeOrderFile(parseOrderFile(raw))).toBe(raw);
  });

  it("preserves CRLF and the absence of a trailing newline", () => {
    const raw = "One\r\nTwo";
    expect(serializeOrderFile(parseOrderFile(raw))).toBe(raw);
  });

  it("writes an empty string for an empty list", () => {
    expect(serializeOrderFile(emptyOrderFile())).toBe("");
  });
});

describe("entry operations", () => {
  const base = parseOrderFile("A\nB\nC\n");

  it("appends new entries at the end and ignores duplicates", () => {
    expect(withEntryAppended(base, "D").entries).toEqual(["A", "B", "C", "D"]);
    expect(withEntryAppended(base, "B")).toBe(base); // unchanged reference = no write
  });

  it("removes an entry and leaves the rest in order", () => {
    expect(withEntryRemoved(base, "B").entries).toEqual(["A", "C"]);
    expect(withEntryRemoved(base, "Z")).toBe(base);
  });

  it("renames in place, preserving position", () => {
    expect(withEntryRenamed(base, "B", "B2").entries).toEqual(["A", "B2", "C"]);
  });

  it("appends when renaming an entry that was never listed", () => {
    expect(withEntryRenamed(base, "Z", "Z2").entries).toEqual(["A", "B", "C", "Z2"]);
  });

  it("moves an entry to an arbitrary index", () => {
    expect(withEntryMoved(base, "C", 0).entries).toEqual(["C", "A", "B"]);
    expect(withEntryMoved(base, "A", 2).entries).toEqual(["B", "C", "A"]);
    expect(withEntryMoved(base, "A", 99).entries).toEqual(["B", "C", "A"]);
    expect(withEntryMoved(base, "A", -5).entries).toEqual(["A", "B", "C"]);
  });

  it("promotes an entry to the home-page position", () => {
    expect(withEntryFirst(base, "C").entries).toEqual(["C", "A", "B"]);
    expect(withEntryFirst(base, "New").entries).toEqual(["New", "A", "B", "C"]);
  });

  it("never mutates the input", () => {
    withEntryRemoved(base, "B");
    withEntryMoved(base, "A", 2);
    expect(base.entries).toEqual(["A", "B", "C"]);
  });
});

describe("withEntriesArranged", () => {
  const base = parseOrderFile("A\nB\nC\n");

  it("adopts the sequence the caller arranged", () => {
    expect(withEntriesArranged(base, ["C", "A", "B"]).entries).toEqual(["C", "A", "B"]);
  });

  it("returns the same file when the sequence is unchanged, so nothing is written", () => {
    expect(withEntriesArranged(base, ["A", "B", "C"])).toBe(base);
  });

  it("ignores names it does not list instead of inventing entries", () => {
    expect(withEntriesArranged(base, ["C", "Ghost", "A", "B"]).entries).toEqual(["C", "A", "B"]);
  });

  it("keeps entries the caller did not mention, in their existing order", () => {
    // A view showing a filtered list must never drop the pages it wasn't showing.
    expect(withEntriesArranged(base, ["C"]).entries).toEqual(["C", "A", "B"]);
  });
});

describe("reconcileOrder", () => {
  it("keeps the existing sequence, appends new pages alphabetically, drops orphans", () => {
    const result = reconcileOrder(parseOrderFile("C\nA\nGone\n"), ["C", "A", "Zebra", "Beta"]);
    expect(result.order.entries).toEqual(["C", "A", "Beta", "Zebra"]);
    expect(result.added).toEqual(["Beta", "Zebra"]);
    expect(result.removed).toEqual(["Gone"]);
    expect(result.changed).toBe(true);
  });

  it("reports no change when .order already matches disk", () => {
    const result = reconcileOrder(parseOrderFile("A\nB\n"), ["A", "B"]);
    expect(result.changed).toBe(false);
    expect(result.order.entries).toEqual(["A", "B"]);
  });

  it("removes duplicate lines", () => {
    const result = reconcileOrder(parseOrderFile("A\nB\nA\n"), ["A", "B"]);
    expect(result.order.entries).toEqual(["A", "B"]);
    expect(result.removed).toEqual(["A"]);
  });

  it("builds a fresh list when there is no .order file yet", () => {
    const result = reconcileOrder(emptyOrderFile(), ["Beta", "Alpha"]);
    expect(result.order.entries).toEqual(["Alpha", "Beta"]);
    expect(result.changed).toBe(true);
  });
});
