const API_BASE = import.meta.env["VITE_API_URL"] || "";

export interface CollectionSummary {
  nsid: string;
  table: string;
  count: number;
  cascades_to: string[];
}

export interface CollectionsListResponse {
  collections: CollectionSummary[];
  total: number;
}

export interface CollectionStats {
  nsid: string;
  table: string;
  count: number;
  unique_dids: number;
  oldest_indexed_at: string | null;
  newest_indexed_at: string | null;
}

export interface CollectionDetail extends CollectionStats {
  cascades_to: string[];
}

export interface RecordSummary {
  uri: string;
  cid: string | null;
  did: string;
  rkey: string;
  indexed_at: string;
}

export interface ListRecordsResponse {
  records: RecordSummary[];
  limit: number;
  offset: number;
}

export interface DeleteResponse {
  nsid: string;
  dry_run: boolean;
  rows_affected: number;
  cascades_to: string[];
}

export class AdminError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...init,
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      if (body.error && typeof body.error === "string") message = body.error;
    } catch {
      // ignore
    }
    throw new AdminError(response.status, message);
  }
  return response.json();
}

export function listCollections(): Promise<CollectionsListResponse> {
  return adminFetch("/admin/collections");
}

export function getCollection(nsid: string): Promise<CollectionDetail> {
  return adminFetch(`/admin/collections/${encodeURIComponent(nsid)}`);
}

export function listRecords(
  nsid: string,
  opts: { did?: string; limit?: number; offset?: number } = {},
): Promise<ListRecordsResponse> {
  const params = new URLSearchParams();
  if (opts.did) params.set("did", opts.did);
  if (opts.limit != null) params.set("limit", String(opts.limit));
  if (opts.offset != null) params.set("offset", String(opts.offset));
  const qs = params.toString();
  return adminFetch(`/admin/collections/${encodeURIComponent(nsid)}/records${qs ? `?${qs}` : ""}`);
}

export interface TableSummary {
  name: string;
  columns: string[];
  count: number;
}

export interface TablesListResponse {
  tables: TableSummary[];
}

export interface ListTableRowsResponse {
  name: string;
  columns: string[];
  rows: Record<string, unknown>[];
  limit: number;
  offset: number;
}

export function listTables(): Promise<TablesListResponse> {
  return adminFetch("/admin/tables");
}

export function listTableRows(
  name: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<ListTableRowsResponse> {
  const params = new URLSearchParams();
  if (opts.limit != null) params.set("limit", String(opts.limit));
  if (opts.offset != null) params.set("offset", String(opts.offset));
  const qs = params.toString();
  return adminFetch(`/admin/tables/${encodeURIComponent(name)}/rows${qs ? `?${qs}` : ""}`);
}

export function deleteCollection(nsid: string, opts: { dryRun: boolean }): Promise<DeleteResponse> {
  const params = new URLSearchParams({
    confirm: nsid,
    dry_run: String(opts.dryRun),
  });
  return adminFetch(`/admin/collections/${encodeURIComponent(nsid)}?${params.toString()}`, {
    method: "DELETE",
  });
}
