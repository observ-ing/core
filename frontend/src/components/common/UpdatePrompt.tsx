import { Snackbar, Button, CircularProgress } from "@mui/material";
import { useRef, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

const HOUR_MS = 60 * 60 * 1000;

export function UpdatePrompt() {
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      registrationRef.current = registration;
      // Check immediately so a freshly opened PWA picks up a deploy without
      // waiting for the hourly tick (mobile suspends backgrounded tabs, so
      // a setInterval timer rarely actually fires).
      registration.update();
      // Re-check whenever the user returns to the app — the most reliable
      // moment on mobile, where setInterval timers don't survive a switch
      // to another app and back.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          registration.update();
        }
      });
      // Hourly backup for long-lived foregrounded sessions.
      setInterval(() => {
        registration.update();
      }, HOUR_MS);
    },
  });

  const [reloading, setReloading] = useState(false);

  const close = () => setNeedRefresh(false);

  const reload = () => {
    setReloading(true);
    const registration = registrationRef.current;
    // When a worker is waiting AND this page is already controlled by a SW,
    // activating it fires "controllerchange", and updateServiceWorker(true)
    // reloads only *then* — once the NEW worker controls the page and serves
    // the fresh index.html with current chunk hashes.
    //
    // Don't reload eagerly here: that races the activating worker. The old
    // index.html would be served while cleanupOutdatedCaches has already purged
    // its chunks, so a lazy route's import() 404s -> the "Update available"
    // chunk-load error screen, which a full browser reload was needed to escape.
    if (registration?.waiting && navigator.serviceWorker.controller) {
      void updateServiceWorker(true);
      // Safety net: if controllerchange somehow never fires (e.g. the new
      // worker fails to activate), still recover instead of leaving the button
      // dead. The normal controllerchange reload tears down this page first, so
      // this only fires when the update is genuinely stuck.
      window.setTimeout(() => window.location.reload(), 5000);
      return;
    }
    // No waiting worker (already activated in another tab / reclaimed) or no
    // prior controller (first, uncontrolled load): controllerchange never
    // fires, so updateServiceWorker can't reload us. A plain reload is correct
    // here — there's no concurrently-activating worker to race.
    window.location.reload();
  };

  return (
    <Snackbar
      open={needRefresh}
      onClose={close}
      message="A new version is available."
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      action={
        <>
          <Button
            color="inherit"
            size="small"
            onClick={reload}
            disabled={reloading}
            startIcon={reloading ? <CircularProgress size={14} color="inherit" /> : undefined}
          >
            {reloading ? "Reloading…" : "Reload"}
          </Button>
          <Button color="inherit" size="small" onClick={close} disabled={reloading}>
            Dismiss
          </Button>
        </>
      }
    />
  );
}
