"use client";

import { useSyncExternalStore } from "react";

// One shared one-second clock for every relative time on screen, so they all
// tick together and no component reads Date.now() while rendering.

let current = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === undefined) {
    current = Date.now();
    timer = setInterval(() => {
      current = Date.now();
      listeners.forEach((notify) => notify());
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

function getSnapshot(): number {
  if (current === 0 || timer === undefined) current = Date.now();
  return current;
}

/** Milliseconds since the epoch, updated once a second. 0 while prerendering. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, () => 0);
}
