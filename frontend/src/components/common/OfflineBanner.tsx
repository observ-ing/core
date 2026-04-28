import { useEffect, useState } from "react";
import { Alert } from "@mui/material";

export function OfflineBanner() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <Alert
      severity="info"
      sx={{
        borderRadius: 0,
        py: 0.5,
        flexShrink: 0,
        borderBottom: 1,
        borderColor: "info.main",
        "& .MuiAlert-message": {
          width: "100%",
          textAlign: "center",
        },
      }}
    >
      You're offline. Some content may be unavailable until you reconnect.
    </Alert>
  );
}
