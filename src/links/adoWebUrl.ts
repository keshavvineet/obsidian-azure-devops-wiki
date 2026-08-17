/**
 * Web-UI URL construction for "Open in Azure DevOps" and "Copy ADO wiki link" (FR-9.1, FR-9.2).
 *
 * ADO-WIKI-FORMAT §6: `pagePath` takes the *title* path (spaces, not hyphens), one segment at a
 * time percent-encoded with the `/` separators left literal — the form every other ADO deep
 * link on the web already uses. Flagged there as needing a live-wiki check; nothing here has
 * been verified against a real organization yet.
 *
 * PURE MODULE — must not import from 'obsidian'.
 */

export interface AdoWebConnection {
  organizationUrl: string;
  project: string;
  wikiName: string;
}

/** null when the connection settings are not filled in — nothing to build a link from. */
export function wikiWebUrl(connection: AdoWebConnection, titlePath: string): string | null {
  const org = connection.organizationUrl.trim().replace(/\/+$/, "");
  const project = connection.project.trim();
  const wikiName = connection.wikiName.trim();
  if (org.length === 0 || project.length === 0 || wikiName.length === 0) return null;

  const encodedPath = encodeTitlePath(titlePath);
  return (
    `${org}/${encodeURIComponent(project)}/_wiki/wikis/${encodeURIComponent(wikiName)}` +
    `/?pagePath=%2F${encodedPath}`
  );
}

/** The path Azure DevOps shows in its own UI, e.g. '/Product Documentation/Setup'. */
export function wikiRelativePath(titlePath: string): string {
  return `/${titlePath}`;
}

function encodeTitlePath(titlePath: string): string {
  return titlePath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join("/");
}
