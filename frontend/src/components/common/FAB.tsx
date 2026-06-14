import { useState } from "react";
import { SpeedDial, SpeedDialAction, SpeedDialIcon } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CameraAltIcon from "@mui/icons-material/CameraAlt";
import AddAPhotoIcon from "@mui/icons-material/AddAPhoto";
import { useAppDispatch, useAppSelector } from "../../store";
import { openUploadModal, setPendingUploadFiles } from "../../store/uiSlice";
import { pickPhotos } from "../../lib/photoPicker";

export function FAB() {
  const dispatch = useAppDispatch();
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

  const handleQuickPhoto = async () => {
    setOpen(false);
    const files = await pickPhotos({ source: "camera" });
    if (files.length > 0) {
      setPendingUploadFiles(files);
      dispatch(openUploadModal());
    }
  };

  const actions = [
    { icon: <CameraAltIcon />, name: "New Observation", action: handleNewObservation },
    { icon: <AddAPhotoIcon />, name: "Quick Photo", action: handleQuickPhoto },
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
