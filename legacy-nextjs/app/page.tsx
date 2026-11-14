"use client";

import { useState } from "react";
import type { AskResult, Verdict } from "@/lib/types";

const STYLES: Record<Verdict, { box: string; label: string }> = {
  supported: {
    box: "border-emerald-600 bg-emerald-50",
    label: "Supported by its source",
  },
  partial: {
    box: "border-amber-500 bg-amber-50",
    label: "Only partly supported",
  },
  unsupported: {
    box: "border-rose-600 bg-rose-50",
    label: "Not supported by its source",
  },
};

export default function Home() {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<AskResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(false);

  async function ask() {
    if (!question.trim() || loading) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed.");
      setResult(data as AskResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setLoading(false);
    }
  }

  const shown = result
    ? result.claims.filter((c) => !verifiedOnly || c.verdict === "supported")
    : [];

  return (
    <main className="mx-auto max-w-2xl px-5 py-12 text-slate-900">
      <h1 className="font-serif text-3xl font-semibold">Checked answers</h1>
      <p className="mt-2 text-slate-600">
        Every sentence in the answer is tested against the source it cites.
      </p>

      <div className="mt-8 flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask()}
          placeholder="Ask a question that needs sources"
          className="flex-1 rounded border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-900"
        />
        <button
          onClick={ask}
          disabled={loading || !question.trim()}
          className="rounded bg-slate-900 px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2 disabled:opacity-40"
        >
          {loading ? "Checking..." : "Ask and verify"}
        </button>
      </div>

      {error && (
        <p className="mt-6 rounded border border-rose-300 bg-rose-50 p-3 text-rose-800">
          {error}
        </p>
      )}

      {!result && !loading && !error && (
        <p className="mt-10 text-slate-500">
          Try a question with a clear right answer, then look for sentences the
          sources do not back up.
        </p>
      )}

      {result && (
        <section className="mt-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-slate-700">
              {result.stats.supported} of {result.stats.total} claims supported
              {result.stats.unsupported > 0 &&
                `, ${result.stats.unsupported} not supported`}
              {result.stats.partial > 0 && `, ${result.stats.partial} partly`}
              <span className="text-slate-500">
                {" "}
                in {(result.stats.ms / 1000).toFixed(1)}s
              </span>
            </p>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={verifiedOnly}
                onChange={(e) => setVerifiedOnly(e.target.checked)}
              />
              Show verified claims only
            </label>
          </div>

          <ul className="mt-4 space-y-3">
            {shown.map((c, i) => (
              <li
                key={i}
                className={`rounded border-l-4 p-3 ${STYLES[c.verdict].box}`}
              >
                <p className="font-serif text-lg leading-relaxed">
                  {c.text}{" "}
                  {c.sourceIds.map((id) => {
                    const s = result.sources.find((x) => x.id === id);
                    return s ? (
                      <a
                        key={id}
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                        className="align-super text-xs text-slate-600 underline"
                      >
                        [{id}]
                      </a>
                    ) : null;
                  })}
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  {STYLES[c.verdict].label}. {c.reason}
                </p>
              </li>
            ))}
            {shown.length === 0 && (
              <li className="text-slate-500">No claims to show.</li>
            )}
          </ul>

          <h2 className="mt-10 text-lg font-semibold">Sources</h2>
          <ol className="mt-2 space-y-1 text-sm">
            {result.sources.map((s) => (
              <li key={s.id}>
                [{s.id}]{" "}
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-slate-700 underline"
                >
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
