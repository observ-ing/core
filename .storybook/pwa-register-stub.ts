/**
 * Stand-in for `virtual:pwa-register/react` in Storybook. Vite's PWA plugin
 * only generates the real virtual module during the app build, so without
 * this alias Storybook can't resolve the import for components like
 * `UpdatePrompt`. The stub returns a static "no update needed" state by
 * default; stories override via the `pwaRegister` parameter.
 */
import { useState, type Dispatch, type SetStateAction } from "react";

export interface RegisterSWOptions {
  onRegisteredSW?: (swUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
}

export interface UseRegisterSWReturn {
  needRefresh: [boolean, Dispatch<SetStateAction<boolean>>];
  offlineReady: [boolean, Dispatch<SetStateAction<boolean>>];
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
}

export function useRegisterSW(_options?: RegisterSWOptions): UseRegisterSWReturn {
  const initialNeedRefresh =
    typeof window !== "undefined" &&
    Boolean((window as unknown as { __SB_PWA_NEED_REFRESH__?: boolean }).__SB_PWA_NEED_REFRESH__);
  const needRefresh = useState(initialNeedRefresh);
  const offlineReady = useState(false);
  const updateServiceWorker = async () => {
    // no-op in storybook
  };
  return { needRefresh, offlineReady, updateServiceWorker };
}
