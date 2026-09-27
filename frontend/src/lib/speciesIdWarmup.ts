import { useSyncExternalStore } from "react";
import { getSpeciesIdStatus } from "../services/api";

/**
 * Shared warm-up state for the species-id services, which scale to zero.
 *
 * `warmSpeciesId()` asks the appview whether the service is warm; if it's
 * cold, that request starts the boot. Callers fire it as early as possible
 * (opening the upload modal, the suggest-ID form, the live camera) so the
 * boot overlaps with the user picking a photo. Components then read
 * `useSpeciesIdReadyAt()` to show a countdown while an ID is pending.
 */

/** Re-check at most this often; a warm instance stays up ~15 min idle. */
const RECHECK_MS = 60_000;

interface ServiceState {
  /** Epoch ms when a cold boot should be done; null when warm or unknown. */
  readyAt: number | null;
  checkedAt: number;
  inflight: boolean;
}

const services: Record<"full" | "live", ServiceState> = {
  full: { readyAt: null, checkedAt: 0, inflight: false },
  live: { readyAt: null, checkedAt: 0, inflight: false },
};
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

export function warmSpeciesId(live = false): void {
  const s = services[live ? "live" : "full"];
  const now = Date.now();
  // Skip while a check is running, or when a recent check is still valid:
  // either it was warm, or a boot we already know about is still counting down.
  if (s.inflight) return;
  if (now - s.checkedAt < RECHECK_MS && (s.readyAt === null || s.readyAt > now)) return;

  s.inflight = true;
  getSpeciesIdStatus(live)
    .then((status) => {
      s.readyAt =
        status.ready || status.estimatedSeconds == null
          ? null
          : Date.now() + status.estimatedSeconds * 1000;
      s.checkedAt = Date.now();
    })
    .catch(() => {
      // Best effort: without a status we just show the plain spinner.
      s.readyAt = null;
    })
    .finally(() => {
      s.inflight = false;
      notify();
    });
}

/** Mark a service warm after an identify request succeeds on it. */
export function markSpeciesIdWarm(live = false): void {
  const s = services[live ? "live" : "full"];
  s.checkedAt = Date.now();
  if (s.readyAt !== null) {
    s.readyAt = null;
    notify();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Epoch ms when a cold species-id service should be ready, or null if warm/unknown. */
export function useSpeciesIdReadyAt(live = false): number | null {
  return useSyncExternalStore(subscribe, () => services[live ? "live" : "full"].readyAt);
}

/** Test-only: reset module state between tests. */
export function resetSpeciesIdWarmupForTests(): void {
  for (const s of Object.values(services)) {
    s.readyAt = null;
    s.checkedAt = 0;
    s.inflight = false;
  }
  notify();
}
