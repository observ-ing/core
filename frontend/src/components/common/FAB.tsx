import { useState } from "react";
import { SpeedDial, SpeedDialAction, SpeedDialIcon } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CameraAltIcon from "@mui/icons-material/CameraAlt";
import CenterFocusStrongIcon from "@mui/icons-material/CenterFocusStrong";
import { useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { useAppDispatch, useAppSelector } from "../../store";
import { openUploadModal } from "../../store/uiSlice";

export function FAB() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const user = useAppSelector((state) => state.auth.user);
  // Controlled open state so we can force the speed-dial closed when an action
  // opens a modal, and keep it closed when focus returns to the FAB after that
  // modal closes (see onOpen below).
  const [open, setOpen] = useState(false);

  if (!user) {
    return null;
  }

  const handleNewObservation = () => {
    setOpen(false);
    dispatch(openUploadModal());
  };

  const handleLiveId = () => {
    navigate("/identify");
  };

  const actions = [
    { icon: <CameraAltIcon />, name: "New Observation", action: handleNewObservation },
    // Live ID relies on getUserMedia, which only works on web/PWA. Native
    // builds would open a broken viewfinder, so hide the entry point there
    // until a Capacitor camera-preview plugin is wired up.
    ...(Capacitor.isNativePlatform()
      ? []
      : [{ icon: <CenterFocusStrongIcon />, name: "Live ID", action: handleLiveId }]),
  ];

  return (
    <SpeedDial
      ariaLabel="Create actions"
      icon={<SpeedDialIcon icon={<AddIcon />} />}
      direction="up"
      open={open}
      // Ignore the "focus" reason: MUI re-opens the dial when focus returns to
      // it after a modal we launched closes, which is the reopen bug. Click
      // ("toggle") and hover ("mouseEnter") still open it.
      onOpen={(_event, reason) => {
        if (reason !== "focus") setOpen(true);
      }}
      onClose={() => setOpen(false)}
      sx={{
        position: "fixed",
        bottom: 16,
        right: 16,
        zIndex: 100,
        "@media (min-width: 900px)": {
          right: "max(16px, calc(50% - 554px))",
        },
      }}
    >
      {actions.map((action) => (
        <SpeedDialAction
          key={action.name}
          icon={action.icon}
          slotProps={{ tooltip: { title: action.name } }}
          onClick={action.action}
        />
      ))}
    </SpeedDial>
  );
}
