import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  markSpeciesIdWarm,
  resetSpeciesIdWarmupForTests,
  useSpeciesIdReadyAt,
  warmSpeciesId,
} from "./speciesIdWarmup";
import { getSpeciesIdStatus } from "../services/api";

vi.mock("../services/api", () => ({
  getSpeciesIdStatus: vi.fn(),
}));

const mockStatus = vi.mocked(getSpeciesIdStatus);
const NOW = 1_700_000_000_000;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("speciesIdWarmup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mockStatus.mockReset();
    resetSpeciesIdWarmupForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports a ready time when the service is cold", async () => {
    mockStatus.mockResolvedValue({ ready: false, estimatedSeconds: 20 });
    const { result } = renderHook(() => useSpeciesIdReadyAt());

    warmSpeciesId();
    await flush();

    expect(result.current).toBe(NOW + 20_000);
  });

  it("reports null when the service is warm", async () => {
    mockStatus.mockResolvedValue({ ready: true });
    const { result } = renderHook(() => useSpeciesIdReadyAt());

    warmSpeciesId();
    await flush();

    expect(result.current).toBeNull();
  });

  it("dedupes checks while one is in flight or recently warm", async () => {
    mockStatus.mockResolvedValue({ ready: true });

    warmSpeciesId();
    warmSpeciesId();
    await flush();
    warmSpeciesId();

    expect(mockStatus).toHaveBeenCalledTimes(1);
  });

  it("re-checks once the recheck window has passed", async () => {
    mockStatus.mockResolvedValue({ ready: true });

    warmSpeciesId();
    await flush();
    vi.setSystemTime(NOW + 61_000);
    warmSpeciesId();

    expect(mockStatus).toHaveBeenCalledTimes(2);
  });

  it("tracks the live service separately", async () => {
    mockStatus.mockResolvedValue({ ready: false, estimatedSeconds: 12 });
    const full = renderHook(() => useSpeciesIdReadyAt());
    const live = renderHook(() => useSpeciesIdReadyAt(true));

    warmSpeciesId(true);
    await flush();

    expect(mockStatus).toHaveBeenCalledWith(true);
    expect(live.result.current).toBe(NOW + 12_000);
    expect(full.result.current).toBeNull();
  });

  it("clears the countdown when an identify succeeds", async () => {
    mockStatus.mockResolvedValue({ ready: false, estimatedSeconds: 20 });
    const { result } = renderHook(() => useSpeciesIdReadyAt());
    warmSpeciesId();
    await flush();

    act(() => markSpeciesIdWarm());

    expect(result.current).toBeNull();
  });

  it("falls back to no countdown when the status check fails", async () => {
    mockStatus.mockRejectedValue(new Error("401"));
    const { result } = renderHook(() => useSpeciesIdReadyAt());

    warmSpeciesId();
    await flush();

    expect(result.current).toBeNull();
  });
});
