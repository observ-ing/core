import { Snackbar, Button } from "@mui/material";
import { useRegisterSW } from "virtual:pwa-register/react";

const HOUR_MS = 60 * 60 * 1000;

export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (registration) {
        setInterval(() => {
          registration.update();
        }, HOUR_MS);
      }
    },
  });

  const close = () => setNeedRefresh(false);

  return (
    <Snackbar
      open={needRefresh}
      onClose={close}
      message="A new version is available."
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      action={
        <>
          <Button color="inherit" size="small" onClick={() => updateServiceWorker(true)}>
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
