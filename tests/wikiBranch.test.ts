import { describe, expect, it } from "vitest";
import { EMPTY_STATUS, type GitStatus } from "../src/git/gitStatus";
import { branchToAdopt } from "../src/git/wikiBranch";

const DEFAULT = "wikiMain";

function status(over: Partial<GitStatus>): GitStatus {
  return { ...EMPTY_STATUS, ...over };
}

/** A branch as a fresh clone has it: checked out, tracking the remote it came from. */
function cloned(branch: string): GitStatus {
  return status({ branch, upstream: `origin/${branch}` });
}

describe("branchToAdopt", () => {
  it("adopts the older provisioned branch name", () => {
    // The whole reason this exists: Azure DevOps never migrated wikis created before it renamed
    // the default branch, and the portal does not show which one you have.
    expect(branchToAdopt(cloned("wikiMaster"), DEFAULT, DEFAULT)).toBe("wikiMaster");
  });

  it("adopts any branch a 'publish code as wiki' repository uses", () => {
    // These are ordinary repositories, so the branch can be anything at all. Restricting
    // adoption to wikiMain/wikiMaster left this whole class of wiki failing its first Sync.
    expect(branchToAdopt(cloned("main"), DEFAULT, DEFAULT)).toBe("main");
    expect(branchToAdopt(cloned("docs"), DEFAULT, DEFAULT)).toBe("docs");
    expect(branchToAdopt(cloned("release/2026-Q3"), DEFAULT, DEFAULT)).toBe("release/2026-Q3");
  });

  it("says nothing to do when the clone is already on the configured branch", () => {
    // Writing the setting anyway would rewrite data.json on every start-up, and that file sits
    // in a vault that is usually OneDrive-synced.
    expect(branchToAdopt(cloned(DEFAULT), DEFAULT, DEFAULT)).toBeNull();
  });

  it("never overrides a branch the user chose", () => {
    // Someone who has typed a branch in settings means it — even while standing on another one,
    // which is exactly when the wrong-branch guard rail should fire instead.
    expect(branchToAdopt(cloned("main"), "docs", DEFAULT)).toBeNull();
    expect(branchToAdopt(cloned("wikiMaster"), "wikiMaster", DEFAULT)).toBeNull();
  });

  it("ignores a local branch that tracks nothing", () => {
    // A scratch branch somebody made locally is not the wiki's branch, however the clone got
    // parked on it. Leaving the setting alone keeps the actionable wrong-branch error.
    expect(branchToAdopt(status({ branch: "my-experiment", upstream: null }), DEFAULT, DEFAULT)).toBeNull();
  });

  it("ignores a detached HEAD", () => {
    // `syncOrchestrator` already explains a detached HEAD in words a non-technical user can act
    // on; adopting a branch name here would replace that with a confusing wrong-branch error.
    expect(
      branchToAdopt(status({ branch: null, detached: true, upstream: null }), DEFAULT, DEFAULT),
    ).toBeNull();
  });

  it("ignores an empty status, which is what a failed git call looks like", () => {
    expect(branchToAdopt(EMPTY_STATUS, DEFAULT, DEFAULT)).toBeNull();
  });
});
