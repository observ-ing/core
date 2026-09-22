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
 * Caps the occurrence lexicon puts on `externalRecords`. The appview enforces
 * the same numbers; checking here too means the form can say so before a save
 * round-trips and fails.
 */
export const MAX_EXTERNAL_RECORDS = 10;
export const MAX_EXTERNAL_RECORD_URI_LENGTH = 512;

/**
 * Schemes the app is willing to write. Narrower than the lexicon's "any URI"
 * for the same reason the reader only links http(s): these entries are shown
 * to people as links, and anything else is likelier a mistake than a record
 * reference. Kept in step with `build_external_records` in the appview.
 */
const SUPPORTED_SCHEMES = ["http://", "https://", "at://"];

/**
 * Hosts we can name a service for, matched as a substring of the hostname so
 * localized iNaturalist nodes (inaturalist.nz, inaturalist.ca) and self-hosted
 * instances resolve too. Anything unrecognized gets no `service` at all rather
 * than a guess — the field is a hint for consumers, not a required label.
 */
const SERVICE_HOSTS: Array<[needle: string, service: string]> = [
  ["inaturalist", "inaturalist"],
  ["bugguide.net", "bugguide"],
];

/**
 * Best-effort `service` identifier for a URI, or `undefined` when we don't
 * recognize the host. Saves the submitter from having to know the lexicon's
 * vocabulary to cross-link an observation.
 */
export function detectExternalRecordService(uri: string): string | undefined {
  const host = parseUri(uri)?.hostname?.toLowerCase();
  if (!host) return undefined;
  return SERVICE_HOSTS.find(([needle]) => host.includes(needle))?.[1];
}

/**
 * Turn a pasted URI into an entry ready to submit, or explain why it can't be
 * one. The message is written for the person typing, not for a log.
 */
export function parseExternalRecordInput(
  input: string,
): { ok: true; record: ExternalRecord } | { ok: false; error: string } {
  const uri = input.trim();
  if (!uri) return { ok: false, error: "Enter a link to the record." };
  if (uri.length > MAX_EXTERNAL_RECORD_URI_LENGTH) {
    return {
      ok: false,
      error: `Links must be under ${MAX_EXTERNAL_RECORD_URI_LENGTH} characters.`,
    };
  }
  if (!SUPPORTED_SCHEMES.some((scheme) => uri.toLowerCase().startsWith(scheme))) {
    return { ok: false, error: "Links must start with https:// or at://." };
  }

  const service = detectExternalRecordService(uri);
  return { ok: true, record: service ? { uri, service } : { uri } };
}

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
