import { describe, expect, it } from "vitest";
import { wikiRelativePath, wikiWebUrl } from "../src/links/adoWebUrl";

const connection = {
  organizationUrl: "https://dev.azure.com/contoso/",
  project: "Product Engineering",
  wikiName: "Product-Engineering.wiki",
};

describe("wikiWebUrl", () => {
  it("builds a pagePath deep link, trimming the org's trailing slash", () => {
    const url = wikiWebUrl(connection, "Product Documentation/A. Connectivity Studio");
    expect(url).toBe(
      "https://dev.azure.com/contoso/Product%20Engineering/_wiki/wikis/Product-Engineering.wiki" +
        "/?pagePath=%2FProduct%20Documentation/A.%20Connectivity%20Studio",
    );
  });

  it("returns null when any connection field is missing", () => {
    expect(wikiWebUrl({ ...connection, organizationUrl: "" }, "Home")).toBeNull();
    expect(wikiWebUrl({ ...connection, project: "" }, "Home")).toBeNull();
    expect(wikiWebUrl({ ...connection, wikiName: "" }, "Home")).toBeNull();
  });
});

describe("wikiRelativePath", () => {
  it("prefixes the title path with a slash", () => {
    expect(wikiRelativePath("Product Documentation/Setup")).toBe("/Product Documentation/Setup");
  });
});
