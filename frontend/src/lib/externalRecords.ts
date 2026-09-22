import type { ExternalRecord } from "../bindings/ExternalRecord";

/**
 * Display names for the `service` identifiers the occurrence lexicon lists as
 * known values. The list is explicitly not exhaustive — anything else falls
 * back to the URI's host (or the raw identifier), so records written by other
 * clients still render sensibly.
 */
const SERVICE_LABELS: Record<string, string> = {
  inaturalist: "iNaturalist",
  bugguide: "BugGuide",
};

/**
 * Human-readable name for the service holding an external record: its known
 * label, else the URI's host with any `www.` stripped, else the bare `service`
 * identifier. AT Protocol records have no host to fall back on, so they get a
 * generic label.
 */
export function getExternalRecordLabel(record: ExternalRecord): string {
  const known = record.service ? SERVICE_LABELS[record.service.toLowerCase()] : undefined;
  if (known) return known;

  const host = getExternalRecordHost(record.uri);
  if (host) return host;

  return record.service || (record.uri.startsWith("at://") ? "AT Protocol record" : record.uri);
}

/**
 * The `href` to open an external record with, or `null` when the URI isn't
 * something a browser can follow. Only http(s) is linkable: `at://` URIs (and
 * any other scheme the lexicon permits) are shown as plain text rather than
 * guessed at, since which appview should render them is not ours to decide.
 */
export function getExternalRecordHref(uri: string): string | null {
  const parsed = parseUri(uri);
  return parsed?.protocol === "http:" || parsed?.protocol === "https:" ? uri : null;
}

function getExternalRecordHost(uri: string): string | null {
  const host = parseUri(uri)?.hostname;
  return host ? host.replace(/^www\./, "") : null;
}

function parseUri(uri: string): URL | null {
  try {
    return new URL(uri);
  } catch {
    return null;
  }
}
