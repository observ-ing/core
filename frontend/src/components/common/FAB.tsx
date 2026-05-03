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

  if (!user) {
    return null;
  }

  const handleNewObservation = () => {
    dispatch(openUploadModal());
  };

  const handleQuickPhoto = async () => {
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
