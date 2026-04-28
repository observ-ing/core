import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Service worker registration is gated behind ?pwa=1 for staged rollout.
// Once registered, the existing registration keeps registration on every
// visit (so updates propagate). Visit /unregister.html to opt out.
async function maybeRegisterServiceWorker() {
  if (!import.meta.env.PROD) return;
  if (!("serviceWorker" in navigator)) return;
  const optInParam = new URLSearchParams(window.location.search).has("pwa");
  const existing = await navigator.serviceWorker.getRegistration();
  if (!optInParam && !existing) return;
  const { registerSW } = await import("virtual:pwa-register");
  registerSW({ immediate: true });
}
void maybeRegisterServiceWorker();
