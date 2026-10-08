/**
 * Where a Capacitor build should send the WebView after a redirect from the
 * appview left it on observ.ing instead of in the bundled app, or `null` when
 * the page isn't one of those landings.
 *
 * The appview finishes its OAuth flows (logging in, linking iNaturalist) by
 * redirecting to a page with a marker query parameter. In a native build that
 * page is the website, so we bounce back to the bundled origin
 * (https://localhost on Android) and the rest of the session runs in the APK
 * shell. The session cookie was set with SameSite=None on observ.ing, so
 * cross-site fetches from the bundled app still authenticate.
 */
export function nativeBounceTarget(search: string): string | null {
  const params = new URLSearchParams(search);
  if (params.get("just-authed") === "1") return "https://localhost/";
  for (const outcome of ["inat-linked", "inat-error"]) {
    if (params.get(outcome) === "1") return `https://localhost/settings?${outcome}=1`;
  }
  return null;
}
