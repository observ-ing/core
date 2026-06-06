import { Snackbar, Button } from "@mui/material";
import { useRegisterSW } from "virtual:pwa-register/react";

const HOUR_MS = 60 * 60 * 1000;

export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
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

  const close = () => setNeedRefresh(false);

  const reload = async () => {
    // updateServiceWorker(true) only reloads via the SW's "controlling" event,
    // which never fires if there's no waiting worker (already activated in
    // another tab, reclaimed by the browser) or no prior controller (first
    // uncontrolled load). Force a reload afterward so the button always works.
    await updateServiceWorker(true);
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
          <Button color="inherit" size="small" onClick={reload}>
            Reload
          </Button>
          <Button color="inherit" size="small" onClick={close}>
            Dismiss
          </Button>
        </>
      }
    />
  );
}
