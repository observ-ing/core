import { useRef } from "react";
import { SpeedDial, SpeedDialAction, SpeedDialIcon } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CameraAltIcon from "@mui/icons-material/CameraAlt";
import AddAPhotoIcon from "@mui/icons-material/AddAPhoto";
import { useAppDispatch, useAppSelector } from "../../store";
import { openUploadModal } from "../../store/uiSlice";

export function FAB() {
  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.auth.user);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Only show FAB when logged in
  if (!user) {
    return null;
  }

  const handleNewObservation = () => {
    dispatch(openUploadModal());
  };

  const handleQuickPhoto = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      dispatch(openUploadModal());
    }
    // Reset input so same file can be selected again
    event.target.value = "";
  };

  const actions = [
    { icon: <CameraAltIcon />, name: "New Observation", action: handleNewObservation },
    { icon: <AddAPhotoIcon />, name: "Quick Photo", action: handleQuickPhoto },
  ];

  return (
    <>
      <input
        type="file"
        accept="image/*"
        capture="environment"
        ref={fileInputRef}
        onChange={handleFileChange}
        style={{ display: "none" }}
      />
      <SpeedDial
        ariaLabel="Create actions"
        icon={<SpeedDialIcon icon={<AddIcon />} />}
        direction="up"
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
    </>
  );
}
