/**
 * Official IUCN Red List category colors.
 * Fixed IUCN standards — not theme-mode-dependent.
 * Centralised here so every consumer shares one source of truth.
 */
export const IUCN_CATEGORY_COLORS = {
  EX: "#000000",
  EW: "#542344",
  CR: "#d81e05",
  EN: "#fc7f3f",
  VU: "#f9e814",
  NT: "#cce226",
  LC: "#60c659",
  DD: "#d1d1c6",
  NE: "#ffffff",
} as const;

/** Categories whose background is light enough to require dark chip text. */
export const IUCN_DARK_TEXT_CATEGORIES: ReadonlySet<string> = new Set([
  "VU",
  "NT",
  "LC",
  "DD",
  "NE",
]);

/** Near-black text for chip contrast against light IUCN backgrounds. */
export const IUCN_CHIP_TEXT_DARK = "#1a1a1a";

/** White text for chip contrast against dark IUCN backgrounds. */
export const IUCN_CHIP_TEXT_LIGHT = "#ffffff";

/**
 * NE (Not Evaluated) has a white background; this border keeps the chip
 * visible on light surfaces.
 */
export const IUCN_NE_BORDER_COLOR = "#d1d1c6";
