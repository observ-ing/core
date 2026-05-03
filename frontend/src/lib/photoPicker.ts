import { Capacitor } from "@capacitor/core";
import { Camera, MediaTypeSelection } from "@capacitor/camera";

export type PhotoSource = "camera" | "gallery";

interface PickPhotosOptions {
  source: PhotoSource;
  multiple?: boolean;
  maxCount?: number;
}

export async function pickPhotos(options: PickPhotosOptions): Promise<File[]> {
  if (Capacitor.isNativePlatform()) {
    return pickNative(options);
  }
  return pickWeb(options);
}

async function pickNative({ source, multiple, maxCount }: PickPhotosOptions): Promise<File[]> {
  // correctOrientation must stay false: the plugin's "correct" pass re-encodes
  // the JPEG and drops EXIF, defeating the entire point of going native here.
  // Quality 100 means no recompression of the source bytes.
  if (source === "camera") {
    const result = await Camera.takePhoto({
      quality: 100,
      correctOrientation: false,
      saveToGallery: false,
    });
    if (!result.webPath) return [];
    return [await fetchAsFile(result.webPath, result.metadata?.format)];
  }

  const { results } = await Camera.chooseFromGallery({
    mediaType: MediaTypeSelection.Photo,
    allowMultipleSelection: multiple ?? false,
    limit: maxCount ?? 0,
    correctOrientation: false,
  });
  return Promise.all(
    results.flatMap((r) => (r.webPath ? [fetchAsFile(r.webPath, r.metadata?.format)] : [])),
  );
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
