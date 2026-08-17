import { describe, expect, it } from "vitest";
import { joinPath, validateTitle } from "../src/naming/titleValidator";
import type { TitleValidationInput } from "../src/naming/titleValidator";

function validate(overrides: Partial<TitleValidationInput> = {}) {
  return validateTitle({
    title: "New Page",
    folderPath: "",
    siblingFileNames: [],
    ...overrides,
  });
}

const codes = (issues: Array<{ code: string }>) => issues.map((i) => i.code);

describe("validateTitle", () => {
  it("accepts a normal title and reports the encoded target", () => {
    const result = validate({ title: "Pre-Release RCA Categories", folderPath: "Scrum" });
    expect(result.ok).toBe(true);
    expect(result.fileName).toBe("Pre%2DRelease-RCA-Categories.md");
    expect(result.path).toBe("Scrum/Pre%2DRelease-RCA-Categories.md");
  });

  it("trims the title before encoding", () => {
    const result = validate({ title: "  Spaced Out  " });
    expect(result.title).toBe("Spaced Out");
    expect(result.fileName).toBe("Spaced-Out.md");
  });

  it("rejects an empty or whitespace-only title", () => {
    expect(codes(validate({ title: "   " }).errors)).toEqual(["empty"]);
  });

  it.each(["a/b", "a\\b", "a#b"])("rejects the forbidden character in %s", (title) => {
    expect(codes(validate({ title }).errors)).toContain("forbidden-character");
  });

  it("reports the forbidden-character problem only once", () => {
    expect(codes(validate({ title: "a/b\\c#d" }).errors)).toEqual(["forbidden-character"]);
  });

  it("rejects control characters and unpaired surrogates", () => {
    expect(codes(validate({ title: "bad\u0007bell" }).errors)).toContain("control-character");
    expect(codes(validate({ title: "lone\ud800half" }).errors)).toContain("control-character");
  });

  it("allows valid surrogate pairs", () => {
    expect(validate({ title: "Release 😀 notes" }).ok).toBe(true);
  });

  it("rejects leading and trailing dots but allows dots inside", () => {
    expect(codes(validate({ title: ".hidden" }).errors)).toContain("leading-or-trailing-dot");
    expect(codes(validate({ title: "trailing." }).errors)).toContain("leading-or-trailing-dot");
    expect(validate({ title: "4.2 Design" }).ok).toBe(true);
  });

  it("rejects Windows reserved names, with or without an extension", () => {
    expect(codes(validate({ title: "CON" }).errors)).toContain("reserved-name");
    expect(codes(validate({ title: "com1.notes" }).errors)).toContain("reserved-name");
    expect(validate({ title: "Console" }).ok).toBe(true);
  });

  it("rejects an exact duplicate in the same folder", () => {
    const result = validate({ title: "Home", siblingFileNames: ["Home.md", "Other.md"] });
    expect(codes(result.errors)).toContain("duplicate");
  });

  it("rejects a case-only clash the filesystem cannot store", () => {
    const result = validate({ title: "home", siblingFileNames: ["Home.md"] });
    expect(codes(result.errors)).toContain("duplicate-case-insensitive");
  });

  it("does not treat the page being renamed as its own duplicate", () => {
    const result = validate({
      title: "Home",
      siblingFileNames: ["Home.md"],
      currentFileName: "Home.md",
    });
    expect(result.ok).toBe(true);
  });

  it("allows a rename that only changes capitalization", () => {
    const result = validate({
      title: "HOME",
      siblingFileNames: ["Home.md"],
      currentFileName: "Home.md",
    });
    expect(result.ok).toBe(true);
  });

  it("errors past 235 characters and warns while approaching it", () => {
    const long = validate({ title: "x".repeat(240) });
    expect(codes(long.errors)).toContain("path-too-long");

    const nearly = validate({ title: "x".repeat(200) });
    expect(nearly.ok).toBe(true);
    expect(codes(nearly.warnings)).toContain("path-length-near-limit");
  });

  it("counts the folder path toward the limit", () => {
    const result = validate({ title: "x".repeat(200), folderPath: "y".repeat(40) });
    expect(codes(result.errors)).toContain("path-too-long");
  });

  it("warns, but does not block, on a title that collides with escape syntax", () => {
    const result = validate({ title: "Coverage %2D report" });
    expect(result.ok).toBe(true);
    expect(codes(result.warnings)).toContain("ambiguous-escape");
  });
});

describe("joinPath", () => {
  it("joins folder and name, treating root as empty", () => {
    expect(joinPath("", "Home.md")).toBe("Home.md");
    expect(joinPath("/", "Home.md")).toBe("Home.md");
    expect(joinPath("Docs", "Home.md")).toBe("Docs/Home.md");
    expect(joinPath("/Docs/", "Home.md")).toBe("Docs/Home.md");
  });
});
