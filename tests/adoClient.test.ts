import { describe, expect, it } from "vitest";
import {
  basicAuthHeader,
  escapeWiqlLiteral,
  idQuery,
  idsFromWiqlResponse,
  isConfigured,
  resolvePat,
  summariesFromBatchResponse,
  titleSearchWiql,
  TtlCache,
  wiqlUrl,
  workItemsBatchUrl,
} from "../src/workitems/adoClient";

describe("resolvePat", () => {
  it("prefers the environment variable when set", () => {
    expect(resolvePat("stored-pat", "env-pat")).toBe("env-pat");
  });

  it("falls back to the stored setting", () => {
    expect(resolvePat("stored-pat", undefined)).toBe("stored-pat");
    expect(resolvePat("stored-pat", "")).toBe("stored-pat");
  });
});

describe("isConfigured", () => {
  it("requires organization, project and a PAT", () => {
    expect(isConfigured({ organizationUrl: "https://dev.azure.com/x", project: "P", pat: "t" })).toBe(
      true,
    );
    expect(isConfigured({ organizationUrl: "", project: "P", pat: "t" })).toBe(false);
    expect(isConfigured({ organizationUrl: "https://dev.azure.com/x", project: "", pat: "t" })).toBe(
      false,
    );
    expect(isConfigured({ organizationUrl: "https://dev.azure.com/x", project: "P", pat: "" })).toBe(
      false,
    );
  });
});

describe("idQuery", () => {
  it("recognizes a purely numeric query", () => {
    expect(idQuery("229849")).toBe(229849);
    expect(idQuery("  123  ")).toBe(123);
  });

  it("rejects anything that is not purely digits", () => {
    expect(idQuery("EDI 123")).toBeNull();
    expect(idQuery("")).toBeNull();
    expect(idQuery("12a")).toBeNull();
  });
});

describe("titleSearchWiql / escapeWiqlLiteral", () => {
  it("doubles embedded single quotes", () => {
    expect(escapeWiqlLiteral("O'Brien")).toBe("O''Brien");
  });

  it("builds a CONTAINS query with the literal escaped", () => {
    const wiql = titleSearchWiql("EDI's setup");
    expect(wiql).toContain("CONTAINS 'EDI''s setup'");
    expect(wiql).toContain("SELECT [System.Id] FROM WorkItems");
  });
});

describe("URL builders", () => {
  it("wiqlUrl trims a trailing slash and encodes the project", () => {
    expect(wiqlUrl("https://dev.azure.com/contoso/", "My Project")).toBe(
      "https://dev.azure.com/contoso/My%20Project/_apis/wit/wiql?api-version=7.1",
    );
  });

  it("workItemsBatchUrl lists the requested fields and ids", () => {
    const url = workItemsBatchUrl("https://dev.azure.com/contoso", "Proj", [1, 2, 3]);
    expect(url).toContain("ids=1,2,3");
    expect(url).toContain("System.Title");
    expect(url).toContain("errorPolicy=omit");
  });
});

describe("basicAuthHeader", () => {
  it("base64-encodes an empty username and the PAT", () => {
    expect(basicAuthHeader("mytoken")).toBe(`Basic ${btoa(":mytoken")}`);
  });
});

describe("response shaping", () => {
  it("idsFromWiqlResponse pulls numeric ids only", () => {
    expect(idsFromWiqlResponse({ workItems: [{ id: 1 }, { id: 2 }, {}] })).toEqual([1, 2]);
    expect(idsFromWiqlResponse(null)).toEqual([]);
    expect(idsFromWiqlResponse({})).toEqual([]);
  });

  it("summariesFromBatchResponse reads the flattened fields", () => {
    const body = {
      value: [
        {
          id: 42,
          fields: {
            "System.Title": "Fix the thing",
            "System.WorkItemType": "Bug",
            "System.State": "Active",
          },
        },
        { id: null }, // omitted by errorPolicy=omit
      ],
    };
    expect(summariesFromBatchResponse(body)).toEqual([
      { id: 42, title: "Fix the thing", type: "Bug", state: "Active" },
    ]);
  });
});

describe("TtlCache", () => {
  it("returns a cached value until it expires", () => {
    let now = 0;
    const cache = new TtlCache<string, number>(1000, () => now);
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
    now = 999;
    expect(cache.get("a")).toBe(1);
    now = 1000;
    expect(cache.get("a")).toBeUndefined();
  });

  it("clear() drops everything", () => {
    const cache = new TtlCache<string, number>(1000);
    cache.set("a", 1);
    cache.clear();
    expect(cache.get("a")).toBeUndefined();
  });
});
