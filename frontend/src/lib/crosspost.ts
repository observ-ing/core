import type { UserPreferencesResponse } from "../services/types";

type CrosspostPrefs = Pick<
  UserPreferencesResponse,
  "crosspostInaturalist" | "crosspostInaturalistRequirePhotos"
>;

/**
 * Whether a new observation starts out set to be posted to iNaturalist. This
 * is only the default for the form's checkbox: the user can still change it,
 * and the server does what the submitted flag says.
 *
 * Posting is off until the user turns it on. Requiring photos is on until they
 * turn it off, since iNaturalist treats an observation without photos as
 * casual.
 */
export function defaultCrosspost(
  prefs: CrosspostPrefs | undefined,
  observation: { photoCount: number },
): boolean {
  if (prefs?.crosspostInaturalist !== true) return false;
  const requirePhotos = prefs.crosspostInaturalistRequirePhotos ?? true;
  return !requirePhotos || observation.photoCount > 0;
}
