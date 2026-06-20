import { Capacitor } from "@capacitor/core";
import { OriginalPhotoPicker } from "capacitor-original-photo-picker";

interface PickPhotosOptions {
  multiple?: boolean;
  maxCount?: number;
}

export async function pickPhotos(options: PickPhotosOptions = {}): Promise<File[]> {
  if (Capacitor.isNativePlatform()) {
    return pickNative();
  }
  return pickWeb(options);
}

async function pickNative(): Promise<File[]> {
  // Use our custom plugin instead of Camera.chooseFromGallery so that
  // MediaStore.setRequireOriginal runs and EXIF GPS survives.
  const result = await OriginalPhotoPicker.pickPhoto();
  if (result.cancelled || !result.base64) return [];
  const blob = base64ToBlob(result.base64, result.mimeType ?? "image/jpeg");
  const filename = result.filename ?? `photo-${Date.now()}.jpg`;
  return [new File([blob], filename, { type: blob.type })];
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

function pickWeb({ multiple }: PickPhotosOptions): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp";
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
