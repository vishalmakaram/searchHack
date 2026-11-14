// Turns a runtime event into one line a person can read.

import type { RuntimeEvent } from "@/lib/events";
import { formatDuration, plural, shortUrl } from "@/lib/format";
import type { Tone } from "@/components/status/tones";

export interface EventLine {
  /** Short category shown before the text. */
  label: string;
  text: string;
  tone: Tone;
  /** Agent chatter: shown quieter, in the monospace face. */
  quiet?: boolean;
}

const url = (value: string | undefined) => (value ? shortUrl(value) : "a page");
const clip = (text: string, max = 220) => (text.length > max ? `${text.slice(0, max)}…` : text);

export function describeEvent(event: RuntimeEvent): EventLine {
  switch (event.type) {
    case "workspace":
      return { label: "Workspace", text: event.query ? `Created for “${clip(event.query, 120)}”` : "Created", tone: "blue" };

    case "build":
      switch (event.phase) {
        case "search":
          return { label: "Build", text: "Searching the web for pages about the query", tone: "blue" };
        case "searched":
          return {
            label: "Build",
            text: `Search returned ${typeof event.urls === "number" ? plural(event.urls, "page") : "its pages"}`,
            tone: "blue",
          };
        case "fetch":
          return { label: "Build", text: "Fetching candidate pages to use as a sample", tone: "blue" };
        case "write":
          return { label: "Build", text: `Builder agent is writing process.py against ${url(event.sample)}`, tone: "blue" };
        case "verify":
          return { label: "Build", text: "Checking the script against the sample page", tone: "blue" };
        case "repair":
          return { label: "Build", text: "The check failed; the builder agent is repairing the script", tone: "amber" };
        case "ready":
          return {
            label: "Build",
            text: `Script ready${typeof event.seconds === "number" ? ` after ${formatDuration(event.seconds * 1000)}` : ""}`,
            tone: "green",
          };
        case "failed":
          return { label: "Build", text: `Build failed${event.error ? `: ${clip(event.error)}` : ""}`, tone: "red" };
      }
      return { label: "Build", text: "Building", tone: "grey" };

    case "agent": {
      const who = event.agent === "worker" ? "Delivery agent" : "Builder agent";
      if (event.phase === "end") return { label: who, text: "Finished", tone: "grey", quiet: true };
      if (event.tool) return { label: who, text: clip(`${event.tool} ${event.args ?? ""}`.trim()), tone: "grey", quiet: true };
      return { label: who, text: clip(event.line ?? ""), tone: "grey", quiet: true };
    }

    case "run":
      switch (event.phase) {
        case "fetch":
          return { label: "Run", text: `Fetching ${url(event.url)}`, tone: "blue" };
        case "fetched":
          return { label: "Run", text: `Fetched ${event.title ? `“${clip(event.title, 80)}”` : url(event.url)}`, tone: "blue" };
        case "processed":
          return event.ok === false
            ? { label: "Run", text: "process.py failed on the page", tone: "red" }
            : { label: "Run", text: event.processed ? `Script read: ${clip(event.processed)}` : "Script processed the page", tone: "blue" };
        case "dropped":
          return { label: "Run", text: `Dropped${event.reason ? `: ${clip(event.reason)}` : ""}`, tone: "grey" };
        case "unchanged":
          return { label: "Run", text: `Unchanged since last time: ${url(event.url)}`, tone: "grey" };
      }
      return { label: "Run", text: "Running", tone: "grey" };

    case "delivery":
      if (event.phase === "start") {
        return {
          label: "Delivery",
          text: event.integrations ? "Delivery agent is recording the result and choosing an output" : "Delivery agent is recording the result (output service not reachable)",
          tone: "blue",
        };
      }
      return event.ok === false
        ? { label: "Delivery", text: "The delivery agent did not finish", tone: "red" }
        : {
            label: "Delivery",
            text: `Delivered${typeof event.seconds === "number" ? ` in ${formatDuration(event.seconds * 1000)}` : ""}${event.reply ? `: ${clip(lastLine(event.reply))}` : ""}`,
            tone: "green",
          };

    case "collect":
      if (event.phase === "polled") return { label: "Collect", text: "Asked the Telem monitor what is new", tone: "blue" };
      return {
        label: "Collect",
        text: `${plural(event.count ?? 0, "new page")}${event.source === "escalation" ? " from a wider search" : " from the monitor"}`,
        tone: (event.count ?? 0) > 0 ? "blue" : "grey",
      };

    case "ws":
      return { label: "Stream", text: "Connected", tone: "grey", quiet: true };
  }
}

function lastLine(text: string): string {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.at(-1) ?? "";
}
