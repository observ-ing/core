import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import { nativeBounceTarget } from "./lib/nativeBounce";
import { App } from "./App";

// Self-hosted brand fonts (bundled, so they work offline in the PWA / native
// shell). DM Sans for UI, JetBrains Mono for data/numerals.
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "@fontsource/jetbrains-mono/700.css";

// After OAuth, the appview redirects to /?just-authed=1 (or, after linking
// iNaturalist, to /settings with a marker). In a Capacitor build that means
// the WebView is sitting on observ.ing — the user logged in, but they're now
// viewing the website rather than the bundled app. Bounce back to the bundled
// origin so the rest of the session runs in the APK shell; see
// `nativeBounceTarget`.
const bounceTarget =
  Capacitor.isNativePlatform() && window.location.hostname !== "localhost"
    ? nativeBounceTarget(window.location.search)
    : null;
if (bounceTarget) {
  window.location.replace(bounceTarget);
} else {
  const root = document.getElementById("root");
  if (!root) throw new Error("Root element not found");
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
