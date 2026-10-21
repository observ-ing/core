// How an upload form's date and identification become fields of a create or
// update request. Shared by the single-observation modal and the batch
// uploader so the same input sends the same request from either.
import type { ObservationInput } from "../services/api";
import type { TaxaResult } from "../services/types";

/** When an observation was made, as an upload form holds it. */
export interface FormDate {
  /** Wall-clock `datetime-local` value, or "" when unknown. */
  date: string;
  /** Optional `YYYY-MM-DD` end of a day range. */
  endDate: string;
  /** UTC offset `date` is in; `null` means the browser's own zone. */
  utcOffset: string | null;
}

/** An identification as an upload form holds it. */
export interface FormTaxon {
  name: string;
  /** The taxonomy entry the name was picked from, or `null` for free text. */
  match: TaxaResult | null;
  kingdom: string;
  rank: string;
}

/** An offset in minutes east of UTC as EXIF and ISO 8601 write it, e.g. "-07:00". */
export function formatUtcOffset(minutesEast: number): string {
  const abs = Math.abs(minutesEast);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${minutesEast < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** The offset the browser's own zone has at `date` (a `datetime-local` value), or now. */
export function browserUtcOffset(date: string): string {
  const at = date ? new Date(date) : new Date();
  return formatUtcOffset(-(isNaN(at.getTime()) ? new Date() : at).getTimezoneOffset());
}

/** Every UTC offset in civil use, west to east. */
export const UTC_OFFSETS: readonly string[] = [
  ...[-720, -660, -600, -570, -540, -480, -420, -360, -300, -240, -210, -180, -120, -60],
  ...[0, 60, 120, 180, 210, 240, 270, 300, 330, 345, 360, 390, 420, 480, 525, 540, 570],
  ...[600, 630, 660, 720, 765, 780, 840],
].map(formatUtcOffset);

export function toEventDate({ date, endDate, utcOffset }: FormDate): string {
  if (endDate) return `${date.slice(0, 10)}/${endDate}`;
  // Without an offset the wall-clock time is read in the browser's zone.
  return new Date(utcOffset ? `${date}:00${utcOffset}` : date).toISOString();
}

/**
 * The request's taxon fields: none for a blank name, the taxon's id for a
 * matched one, and the rank the user chose for free text.
 */
export function taxonFields(
  taxon: FormTaxon,
): Pick<ObservationInput, "scientificName" | "kingdom" | "taxonRank" | "taxonId"> {
  const name = taxon.name.trim();
  if (!name) return {};
  return {
    scientificName: name,
    ...(taxon.kingdom ? { kingdom: taxon.kingdom } : {}),
    ...(!taxon.match && taxon.rank ? { taxonRank: taxon.rank } : {}),
    ...(taxon.match?.taxonId ? { taxonId: taxon.match.taxonId } : {}),
  };
}
