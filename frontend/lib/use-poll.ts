"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface PollState<T> {
  /** The latest successful result. Kept while a later poll fails. */
  data: T | undefined;
  /** The error from the latest poll, or null if it succeeded. */
  error: unknown;
  /** True until the first poll for this fetcher has settled. */
  loading: boolean;
  /** Fetch now, without waiting for the next tick. Resolves when it has landed. */
  refresh: () => Promise<void>;
}

interface Settled<T> {
  fetcher: () => Promise<T>;
  data: T | undefined;
  error: unknown;
}

/**
 * Calls `fetcher` now and then every `intervalMs`, for as long as the
 * component is mounted and the tab is visible.
 *
 * Pass a stable function (wrap it in useCallback). When its identity changes,
 * for example because a filter changed, the old result is dropped and polling
 * starts again.
 *
 * Polling stops on cleanup. Next.js keeps routes you navigate away from
 * mounted but hidden and cleans up their effects, so a hidden page does not
 * keep polling.
 */
export function usePoll<T>(fetcher: () => Promise<T>, intervalMs = 2000): PollState<T> {
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const tickRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let latest = 0;

    const tick = async () => {
      clearTimeout(timer);
      const ticket = ++latest;
      let data: T | undefined;
      let error: unknown = null;
      let ok = false;
      try {
        data = await fetcher();
        ok = true;
      } catch (caught) {
        error = caught ?? new Error("Request failed");
      }
      // A newer request, or cleanup, makes this answer stale.
      if (stopped || ticket !== latest) return;
      setSettled((prev) => ({
        fetcher,
        data: ok ? data : prev?.fetcher === fetcher ? prev.data : undefined,
        error,
      }));
      if (!document.hidden) timer = setTimeout(tick, intervalMs);
    };

    const onVisibility = () => {
      if (document.hidden) clearTimeout(timer);
      else void tick();
    };

    tickRef.current = tick;
    document.addEventListener("visibilitychange", onVisibility);
    void tick();

    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fetcher, intervalMs]);

  const refresh = useCallback(() => tickRef.current(), []);

  // A result that belongs to an earlier fetcher is not this fetcher's data.
  const current = settled?.fetcher === fetcher ? settled : null;
  return {
    data: current?.data,
    error: current?.error ?? null,
    loading: current === null,
    refresh,
  };
}
