import { Capacitor, registerPlugin } from "@capacitor/core";
import { Camera } from "@capacitor/camera";

export type PhotoSource = "camera" | "gallery";

interface PickPhotosOptions {
  source: PhotoSource;
  multiple?: boolean;
  maxCount?: number;
}

interface OriginalPhotoPickerPlugin {
  pickPhoto(): Promise<{
    cancelled: boolean;
    base64?: string;
    mimeType?: string;
    filename?: string;
  }>;
}

// In-app native plugin (see android/app/src/main/java/ing/observ/app/
// OriginalPhotoPickerPlugin.java). Exists because @capacitor/camera does not
// preserve EXIF GPS on Android — see issues #1074, #2118, #2147 upstream.
const OriginalPhotoPicker = registerPlugin<OriginalPhotoPickerPlugin>("OriginalPhotoPicker");

export async function pickPhotos(options: PickPhotosOptions): Promise<File[]> {
  if (Capacitor.isNativePlatform()) {
    return pickNative(options);
  }
  return pickWeb(options);
}

async function pickNative({ source }: PickPhotosOptions): Promise<File[]> {
  if (source === "gallery") {
    // Use our custom plugin instead of Camera.chooseFromGallery so that
    // MediaStore.setRequireOriginal runs and EXIF GPS survives.
    const result = await OriginalPhotoPicker.pickPhoto();
    if (result.cancelled || !result.base64) return [];
    const blob = base64ToBlob(result.base64, result.mimeType ?? "image/jpeg");
    const filename = result.filename ?? `photo-${Date.now()}.jpg`;
    return [new File([blob], filename, { type: blob.type })];
  }

  // Camera path stays on @capacitor/camera. EXIF preservation here is at the
  // mercy of the user's camera app — there's no setRequireOriginal equivalent
  // for ACTION_IMAGE_CAPTURE.
  const result = await Camera.takePhoto({
    quality: 100,
    correctOrientation: false,
    saveToGallery: false,
  });
  if (!result.webPath) return [];
  return [await fetchAsFile(result.webPath, result.metadata?.format)];
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

async function fetchAsFile(webPath: string, format?: string): Promise<File> {
  const response = await fetch(webPath);
  const blob = await response.blob();
  const ext = (format ?? "jpg").replace("jpeg", "jpg");
  const type = blob.type || `image/${ext === "jpg" ? "jpeg" : ext}`;
  return new File([blob], `photo-${Date.now()}.${ext}`, { type });
}

function pickWeb({ source, multiple }: PickPhotosOptions): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp";
    if (source === "camera") {
      input.setAttribute("capture", "environment");
    }
    if (multiple) {
      input.multiple = true;
    }
    input.style.display = "none";
    input.addEventListener("change", () => {
      resolve(Array.from(input.files ?? []));
      input.remove();
    });
    input.addEventListener("cancel", () => {
      resolve([]);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}
