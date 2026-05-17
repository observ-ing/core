export const LICENSE_OPTIONS = [
  { value: "CC0-1.0", label: "CC0 (Public Domain)" },
  { value: "CC-BY-4.0", label: "CC BY (Attribution)" },
  { value: "CC-BY-NC-4.0", label: "CC BY-NC (Attribution, Non-Commercial)" },
  { value: "CC-BY-SA-4.0", label: "CC BY-SA (Attribution, Share-Alike)" },
  {
    value: "CC-BY-NC-SA-4.0",
    label: "CC BY-NC-SA (Attribution, Non-Commercial, Share-Alike)",
  },
] as const;

export type LicenseValue = (typeof LICENSE_OPTIONS)[number]["value"];

export const DEFAULT_LICENSE: LicenseValue = "CC-BY-4.0";

export function isLicenseValue(value: string): value is LicenseValue {
  return LICENSE_OPTIONS.some((opt) => opt.value === value);
}

/**
 * Map an SPDX license identifier to its human-readable label. Returns the
 * input string verbatim for unknown values so unrecognized licenses still
 * render (e.g. records written by other clients with values outside our
 * allow-list).
 */
export function getLicenseLabel(value: string): string {
  return LICENSE_OPTIONS.find((opt) => opt.value === value)?.label ?? value;
}
