"use client";

import { useSyncExternalStore } from "react";
import { parseEvent, type RuntimeEvent } from "./events";

// One WebSocket to the Sentinel runtime, shared by every component that
// listens. It opens when the first listener mounts, closes when the last one
// leaves, and reconnects with a growing delay if the runtime goes away.

export interface StreamEvent {
  /** Unique within this page load; use as a React key. */
  key: number;
  event: RuntimeEvent;
}

export interface StreamState {
  /** Oldest first. Capped at the newest MAX_EVENTS. */
  events: StreamEvent[];
  status: "connecting" | "live" | "offline";
}

const MAX_EVENTS = 500;
const EMPTY: StreamState = { events: [], status: "connecting" };

let state: StreamState = EMPTY;
let socket: WebSocket | null = null;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryDelay = 1000;
let nextKey = 1;
// The runtime replays its recent history on every connect; these are the
// frames already shown, so a reconnect does not repeat them.
const seenFrames = new Set<string>();
const listeners = new Set<() => void>();

function publish(next: StreamState) {
  state = next;
  listeners.forEach((notify) => notify());
}

/**
 * The runtime's WebSocket address. NEXT_PUBLIC_SENTINEL_WS overrides it;
 * otherwise it is port 8000 on whatever host this page was loaded from, so it
 * works on localhost and over a LAN or tailscale address alike.
 */
function streamUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SENTINEL_WS;
  if (configured) return configured;
  return `ws://${window.location.hostname}:8000/ws`;
}

function connect() {
  clearTimeout(retryTimer);
  let opened: WebSocket;
  try {
    opened = new WebSocket(streamUrl());
  } catch {
    scheduleRetry();
    return;
  }
  socket = opened;

  opened.onopen = () => {
    retryDelay = 1000;
    publish({ ...state, status: "live" });
  };
  opened.onmessage = (message) => {
    if (typeof message.data !== "string" || seenFrames.has(message.data)) return;
    const event = parseEvent(message.data);
    // Connection notices are about the socket, not the pipeline.
    if (!event || event.type === "ws") return;
    seenFrames.add(message.data);
    if (seenFrames.size > MAX_EVENTS * 4) seenFrames.clear();
    const events = [...state.events, { key: nextKey++, event }].sort((a, b) => a.event.at - b.event.at);
    publish({ ...state, events: events.slice(-MAX_EVENTS) });
  };
  opened.onclose = () => {
    if (socket !== opened) return;
    socket = null;
    publish({ ...state, status: "offline" });
    if (listeners.size > 0) scheduleRetry();
  };
  // An error is always followed by close, which handles the retry.
  opened.onerror = () => {};
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(connect, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 15_000);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!socket) connect();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearTimeout(retryTimer);
      const closing = socket;
      socket = null;
      closing?.close();
    }
  };
}

const getSnapshot = () => state;
const getServerSnapshot = () => EMPTY;

/** Every live event received so far, and whether the stream is connected. */
export function useEventStream(): StreamState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
