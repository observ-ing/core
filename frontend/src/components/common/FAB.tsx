import { useState } from "react";
import { Backdrop, SpeedDial, SpeedDialAction, SpeedDialIcon } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CameraAltIcon from "@mui/icons-material/CameraAlt";
import CenterFocusStrongIcon from "@mui/icons-material/CenterFocusStrong";
import PhotoLibraryIcon from "@mui/icons-material/PhotoLibrary";
import { useNavigate } from "react-router-dom";
import type { Theme } from "@mui/material/styles";
import { Capacitor } from "@capacitor/core";
import { useAppDispatch, useAppSelector } from "../../store";
import { openUploadModal } from "../../store/uiSlice";
import { useBatchUploadAvailable } from "../../hooks/useBatchUploadAvailable";
import { BATCH_UPLOAD_PATH } from "../layout/NavConfig";
import { cornerPinSx } from "./layoutSx";

export function FAB() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const user = useAppSelector((state) => state.auth.user);
  // Controlled open state so we can force the speed-dial closed when an action
  // opens a modal, and keep it closed when focus returns to the FAB after that
  // modal closes (see onOpen below).
  const [open, setOpen] = useState(false);
  const batchUpload = useBatchUploadAvailable();

  if (!user) {
    return null;
  }

  const handleNewObservation = () => {
    setOpen(false);
    dispatch(openUploadModal());
  };

  // Close before leaving, or the backdrop stays up over the next page.
  const goTo = (path: string) => {
    setOpen(false);
    void navigate(path);
  };

  const actions = [
    { icon: <CameraAltIcon />, name: "New Observation", action: handleNewObservation },
    // Live ID relies on getUserMedia, which only works on web/PWA. Native
    // builds would open a broken viewfinder, so hide the entry point there
    // until a Capacitor camera-preview plugin is wired up.
    ...(Capacitor.isNativePlatform()
      ? []
      : [{ icon: <CenterFocusStrongIcon />, name: "Live ID", action: () => goTo("/identify") }]),
    ...(batchUpload
      ? [
          {
            icon: <PhotoLibraryIcon />,
            name: "Batch upload",
            action: () => goTo(BATCH_UPLOAD_PATH),
          },
        ]
      : []),
  ];

  // The labels stay up while the dial is open, so nobody has to hover or
  // long-press to learn what an icon does. The backdrop keeps them legible over
  // the page, and covers the top bar along with it.
  const raised = (theme: Theme) => theme.zIndex.drawer + 2;

  return (
    <>
      <Backdrop
        open={open}
        onClick={() => setOpen(false)}
        sx={(theme) => ({ zIndex: raised(theme) })}
      />
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
        sx={[
          cornerPinSx("bottom-right", { size: "lg", position: "fixed" }),
          (theme) => ({ zIndex: open ? raised(theme) + 1 : 100 }),
          {
            "@media (min-width: 900px)": {
              right: "max(16px, calc(50% - 554px))",
            },
          },
        ]}
      >
        {actions.map((action) => (
          <SpeedDialAction
            key={action.name}
            icon={action.icon}
            slotProps={{
              tooltip: { open: true, title: action.name },
              // The label is positioned against the action, so it would wrap at
              // the action's width without this.
              staticTooltipLabel: { sx: { whiteSpace: "nowrap" } },
            }}
            onClick={action.action}
          />
        ))}
      </SpeedDial>
    </>
  );
}
