import { describe, expect, it } from "vitest";
import { TITLE_CHAR_TO_ESCAPE, MAX_FULL_PATH_CHARS } from "../src/constants";

// Smoke test proving the vitest harness runs; real coverage starts in Phase 1
// with pageNameCodec (see PLAN.md).
describe("constants", () => {
  it("encodes exactly the eight documented characters", () => {
    expect([...TITLE_CHAR_TO_ESCAPE.keys()].sort()).toEqual(
      ['"', "*", "-", ":", "<", ">", "?", "|"].sort(),
    );
  });

  it("matches ADO's documented path limit", () => {
    expect(MAX_FULL_PATH_CHARS).toBe(235);
  });
});
