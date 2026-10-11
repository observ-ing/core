import type { ReactNode } from "react";
import CameraAltIcon from "@mui/icons-material/CameraAlt";
import CenterFocusStrongIcon from "@mui/icons-material/CenterFocusStrong";
import PhotoLibraryIcon from "@mui/icons-material/PhotoLibrary";
import { useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { useAppDispatch } from "../store";
import { openUploadModal } from "../store/uiSlice";
import { useBatchUploadAvailable } from "./useBatchUploadAvailable";
import { BATCH_UPLOAD_PATH } from "../components/layout/NavConfig";

export interface CreateAction {
  icon: ReactNode;
  name: string;
  action: () => void;
}

/**
 * The ways to create observations, shared by the mobile speed dial and the
 * desktop top-bar menu. Callers close their own menu before running an action.
 */
export function useCreateActions(): CreateAction[] {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const batchUpload = useBatchUploadAvailable();

  return [
    {
      icon: <CameraAltIcon />,
      name: "New Observation",
      action: () => dispatch(openUploadModal()),
    },
    ...(batchUpload
      ? [
          {
            icon: <PhotoLibraryIcon />,
            name: "Batch upload",
            action: () => void navigate(BATCH_UPLOAD_PATH),
          },
        ]
      : []),
    // Live ID relies on getUserMedia, which only works on web/PWA. Native
    // builds would open a broken viewfinder, so hide the entry point there
    // until a Capacitor camera-preview plugin is wired up.
    ...(Capacitor.isNativePlatform()
      ? []
      : [
          {
            icon: <CenterFocusStrongIcon />,
            name: "Live ID",
            action: () => void navigate("/identify"),
          },
        ]),
  ];
}
