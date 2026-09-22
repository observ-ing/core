export const LICENSE_OPTIONS = [
  { value: "https://creativecommons.org/publicdomain/zero/1.0/", label: "CC0 (Public Domain)" },
  { value: "https://creativecommons.org/licenses/by/4.0/", label: "CC BY (Attribution)" },
  {
    value: "https://creativecommons.org/licenses/by-nc/4.0/",
    label: "CC BY-NC (Attribution, Non-Commercial)",
  },
  {
    value: "https://creativecommons.org/licenses/by-sa/4.0/",
    label: "CC BY-SA (Attribution, Share-Alike)",
  },
  {
    value: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    label: "CC BY-NC-SA (Attribution, Non-Commercial, Share-Alike)",
  },
] as const;

export type LicenseValue = (typeof LICENSE_OPTIONS)[number]["value"];

export const DEFAULT_LICENSE: LicenseValue = "https://creativecommons.org/licenses/by/4.0/";

/**
 * SPDX identifiers the media lexicon used before it moved to license URIs.
 * The appview upgrades these on read, so they shouldn't reach us from the API —
 * but an optimistic cache entry or a record written by another client still can,
 * and a recognizable label beats rendering the bare identifier.
 */
const LEGACY_SPDX_LABELS: Record<string, string> = {
  "CC0-1.0": "CC0 (Public Domain)",
  "CC-BY-4.0": "CC BY (Attribution)",
  "CC-BY-NC-4.0": "CC BY-NC (Attribution, Non-Commercial)",
  "CC-BY-SA-4.0": "CC BY-SA (Attribution, Share-Alike)",
  "CC-BY-NC-SA-4.0": "CC BY-NC-SA (Attribution, Non-Commercial, Share-Alike)",
};

export function isLicenseValue(value: string): value is LicenseValue {
  return LICENSE_OPTIONS.some((opt) => opt.value === value);
}

/**
 * Map a license URI to its human-readable label. Returns the input string
 * verbatim for unknown values so unrecognized licenses still render (e.g.
 * records written by other clients with values outside our allow-list).
 */
export function getLicenseLabel(value: string): string {
  return (
    LICENSE_OPTIONS.find((opt) => opt.value === value)?.label ?? LEGACY_SPDX_LABELS[value] ?? value
  );
}
