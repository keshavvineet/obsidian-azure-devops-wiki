import { requestUrl } from "obsidian";

/**
 * Azure DevOps work-item REST access (FR-6.1, FR-6.2, ARCHITECTURE §4.6).
 *
 * `requestUrl` (Obsidian's fetch wrapper) is used instead of the browser's `fetch` because it
 * bypasses CORS from the Electron renderer — the same reason every other Obsidian plugin that
 * talks to a REST API uses it.
 *
 * The query-building and caching pieces are plain functions/classes with no network call in
 * them, so they are tested directly; `AdoClient` is the thin wrapper that actually calls out.
 */

export interface WorkItemSummary {
  id: number;
  title: string;
  type: string;
  state: string;
}

const API_VERSION = "7.1";
const WORK_ITEM_FIELDS = ["System.Id", "System.Title", "System.WorkItemType", "System.State"];
const MAX_TITLE_MATCHES = 20;

// ------------------------------------------------------------------------------------- pure

/**
 * The PAT actually in effect. An environment variable always wins over the stored setting
 * (ARCHITECTURE §5) — it lets a shared machine or a CI-built vault avoid putting a token in
 * plugin data at all.
 */
export function resolvePat(settingsPat: string, envPat: string | undefined): string {
  return envPat && envPat.trim().length > 0 ? envPat.trim() : settingsPat.trim();
}

export interface AdoConnection {
  organizationUrl: string;
  project: string;
  pat: string;
}

export function isConfigured(connection: AdoConnection): boolean {
  return (
    connection.organizationUrl.trim().length > 0 &&
    connection.project.trim().length > 0 &&
    connection.pat.length > 0
  );
}

/** A query that is entirely digits is tried as a work-item id first. */
export function idQuery(text: string): number | null {
  const trimmed = text.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

/** WIQL string literals escape a quote by doubling it, the same as SQL. */
export function escapeWiqlLiteral(text: string): string {
  return text.replace(/'/g, "''");
}

export function titleSearchWiql(text: string): string {
  return (
    "SELECT [System.Id] FROM WorkItems " +
    `WHERE [System.Title] CONTAINS '${escapeWiqlLiteral(text)}' ` +
    "ORDER BY [System.ChangedDate] DESC"
  );
}

function trimTrailingSlash(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function wiqlUrl(organizationUrl: string, project: string): string {
  return `${trimTrailingSlash(organizationUrl)}/${encodeURIComponent(project)}/_apis/wit/wiql?api-version=${API_VERSION}`;
}

export function workItemsBatchUrl(
  organizationUrl: string,
  project: string,
  ids: readonly number[],
): string {
  const fields = WORK_ITEM_FIELDS.join(",");
  return (
    `${trimTrailingSlash(organizationUrl)}/${encodeURIComponent(project)}/_apis/wit/workitems` +
    `?ids=${ids.join(",")}&fields=${fields}&api-version=${API_VERSION}&errorPolicy=omit`
  );
}

export function basicAuthHeader(pat: string): string {
  const encoded =
    typeof btoa === "function" ? btoa(`:${pat}`) : Buffer.from(`:${pat}`).toString("base64");
  return `Basic ${encoded}`;
}

/** Shape of a WIQL response — only the ids matter to the caller. */
export function idsFromWiqlResponse(body: unknown): number[] {
  const items = (body as { workItems?: Array<{ id?: number }> } | null)?.workItems ?? [];
  return items.map((item) => item.id).filter((id): id is number => typeof id === "number");
}

/** Shape of a work-items batch response — one summary per returned item, omitted ids dropped. */
export function summariesFromBatchResponse(body: unknown): WorkItemSummary[] {
  const items =
    (body as { value?: Array<{ id?: number; fields?: Record<string, unknown> }> } | null)
      ?.value ?? [];
  const summaries: WorkItemSummary[] = [];
  for (const item of items) {
    if (typeof item.id !== "number") continue;
    const fields = item.fields ?? {};
    summaries.push({
      id: item.id,
      title: String(fields["System.Title"] ?? ""),
      type: String(fields["System.WorkItemType"] ?? ""),
      state: String(fields["System.State"] ?? ""),
    });
  }
  return summaries;
}

/** A small TTL cache — one entry per distinct query, so retyping a search is free. */
export class TtlCache<K, V> {
  private readonly store = new Map<K, { value: V; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V): void {
    this.store.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  clear(): void {
    this.store.clear();
  }
}

// ----------------------------------------------------------------------------------- client

const CACHE_TTL_MS = 15 * 60_000;

export class AdoClient {
  private readonly cache = new TtlCache<string, WorkItemSummary[]>(CACHE_TTL_MS);
  private readonly byId = new TtlCache<number, WorkItemSummary | null>(CACHE_TTL_MS);

  constructor(private readonly connection: () => AdoConnection) {}

  get configured(): boolean {
    return isConfigured(this.connection());
  }

  /** Cleared when the connection settings change, so a stale org/PAT never leaks into a hit. */
  invalidate(): void {
    this.cache.clear();
    this.byId.clear();
  }

  /** FR-6.2: digits try a direct id lookup first, falling back to a title search either way. */
  async search(text: string): Promise<WorkItemSummary[]> {
    const trimmed = text.trim();
    if (!this.configured || trimmed.length === 0) return [];

    const cached = this.cache.get(trimmed);
    if (cached) return cached;

    const id = idQuery(trimmed);
    const results = id !== null ? await this.searchById(id, trimmed) : await this.searchByTitle(trimmed);
    this.cache.set(trimmed, results);
    return results;
  }

  /** FR-6.3: a single work item's summary, cached separately from search results. */
  async getById(id: number): Promise<WorkItemSummary | null> {
    if (!this.configured) return null;
    const cached = this.byId.get(id);
    if (cached !== undefined) return cached;

    const [summary] = await this.getByIds([id]);
    const result = summary ?? null;
    this.byId.set(id, result);
    return result;
  }

  private async searchById(id: number, fallbackText: string): Promise<WorkItemSummary[]> {
    const direct = await this.getByIds([id]);
    return direct.length > 0 ? direct : this.searchByTitle(fallbackText);
  }

  private async searchByTitle(text: string): Promise<WorkItemSummary[]> {
    const { organizationUrl, project } = this.connection();
    const ids = idsFromWiqlResponse(
      await this.postJson(wiqlUrl(organizationUrl, project), { query: titleSearchWiql(text) }),
    );
    if (ids.length === 0) return [];
    return this.getByIds(ids.slice(0, MAX_TITLE_MATCHES));
  }

  private async getByIds(ids: readonly number[]): Promise<WorkItemSummary[]> {
    if (ids.length === 0) return [];
    const { organizationUrl, project } = this.connection();
    const body = await this.getJson(workItemsBatchUrl(organizationUrl, project, ids));
    return summariesFromBatchResponse(body);
  }

  private headers(): Record<string, string> {
    return {
      Authorization: basicAuthHeader(this.connection().pat),
      Accept: "application/json",
    };
  }

  private async getJson(url: string): Promise<unknown> {
    const response = await requestUrl({ url, method: "GET", headers: this.headers(), throw: false });
    return this.parse(response);
  }

  private async postJson(url: string, body: unknown): Promise<unknown> {
    const response = await requestUrl({
      url,
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
      throw: false,
    });
    return this.parse(response);
  }

  private parse(response: { status: number; json: unknown }): unknown {
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Azure DevOps returned status ${response.status}.`);
    }
    return response.json;
  }
}
