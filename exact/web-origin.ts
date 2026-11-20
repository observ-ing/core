// The site's own origin, for its sign-in callback page. A deployed site's
// callback needs a grant; a loopback dev page's doesn't, so the dev loop's
// origin stands in when no site is named. It's the page's origin, not a server
// app.ts calls, so it lives apart from app.ts's server settings (Exact's
// server discovery takes the first local setting app.ts reads).
export const WEB = import.meta.env.OBSERVING_WEB_ORIGIN ?? 'http://127.0.0.1:8765';
