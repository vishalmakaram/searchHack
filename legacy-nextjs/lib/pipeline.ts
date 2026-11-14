import Anthropic from "@anthropic-ai/sdk";
import { searchWeb } from "./tavily";
import type { AskResult, Claim, Source, Verdict } from "./types";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

const ANSWER_MODEL = "claude-sonnet-5-5"; // writes the answer
const CHECK_MODEL = "claude-haiku-5-5"; // checks claims: cheaper and faster

async function callClaude(
  model: string,
  system: string,
  user: string,
  opts: { maxTokens: number; effort: "low" | "medium"; fallback?: boolean }
): Promise<string> {
  // Both models think by default, and thinking tokens count against max_tokens,
  // so leave headroom and keep effort low for these short, structured tasks.
  const msg = await client.beta.messages.create({
    model,
    max_tokens: opts.maxTokens,
    output_config: { effort: opts.effort },
    system,
    messages: [{ role: "user", content: user }],
    // If the answer model declines, the API reruns the request on a fallback model.
    ...(opts.fallback
      ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
      : {}),
  });
  if (msg.stop_reason === "refusal") throw new Error("The model declined to answer this question.");
  if (msg.stop_reason === "max_tokens") throw new Error(`${model} ran out of output tokens.`);
  return msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
}

const VERDICTS: Verdict[] = ["supported", "partial", "unsupported"];

function parseJson<T>(text: string): T {
  // Models sometimes wrap JSON in code fences. Strip them before parsing.
  return JSON.parse(text.replace(/```json|```/g, "").trim()) as T;
}

function formatSources(sources: Source[]): string {
  return sources.map((s) => `[${s.id}] ${s.title}\n${s.content}`).join("\n\n");
}

// Step 1: write an answer as a list of single-fact claims, each citing sources.
async function draftClaims(
  question: string,
  sources: Source[]
): Promise<{ text: string; sourceIds: number[] }[]> {
  const system = `You answer questions using only the numbered sources provided.
Break your answer into short claims. Each claim is one sentence with one fact.
Cite the source numbers that back each claim.
Reply with JSON only, in this shape:
{"claims":[{"text":"...","sourceIds":[1,2]}]}`;

  const raw = await callClaude(
    ANSWER_MODEL,
    system,
    `Question: ${question}\n\nSources:\n${formatSources(sources)}`,
    { maxTokens: 16000, effort: "medium", fallback: true }
  );
  const parsed = parseJson<{ claims?: { text?: unknown; sourceIds?: unknown }[] }>(raw);
  // Normalize so a malformed claim can't crash the checker or the UI.
  return (parsed.claims ?? [])
    .filter((c) => typeof c.text === "string" && c.text.trim())
    .map((c) => ({
      text: c.text as string,
      sourceIds: Array.isArray(c.sourceIds) ? c.sourceIds.map(Number).filter(Number.isFinite) : [],
    }));
}

// Step 2: check one claim against only the sources it cites.
async function checkClaim(
  claim: { text: string; sourceIds: number[] },
  sources: Source[]
): Promise<Claim> {
  const cited = sources.filter((s) => claim.sourceIds.includes(s.id));

  if (cited.length === 0) {
    return { ...claim, verdict: "unsupported", reason: "The claim cites no source." };
  }

  const system = `You check whether a claim is supported by source text.
Use only the source text given. Never use outside knowledge.
Verdicts:
- "supported": the text states the claim or clearly implies it.
- "partial": the text backs part of the claim, or the claim goes further than the text.
- "unsupported": the text does not back the claim, or contradicts it.
Reply with JSON only: {"verdict":"supported|partial|unsupported","reason":"one short sentence"}`;

  try {
    const raw = await callClaude(
      CHECK_MODEL,
      system,
      `Claim: ${claim.text}\n\nSource text:\n${formatSources(cited)}`,
      { maxTokens: 4000, effort: "low" }
    );
    const out = parseJson<{ verdict: Verdict; reason: string }>(raw);
    if (!VERDICTS.includes(out.verdict)) throw new Error("bad verdict");
    return { ...claim, verdict: out.verdict, reason: String(out.reason ?? "") };
  } catch {
    // If the checker returns something unreadable, mark the claim "partial"
    // so it is neither trusted nor counted as a confirmed error.
    return { ...claim, verdict: "partial", reason: "The check could not be completed." };
  }
}

export async function runPipeline(question: string): Promise<AskResult> {
  const start = Date.now();

  const sources = await searchWeb(question);
  if (sources.length === 0) throw new Error("The web search returned no results.");
  const drafted = await draftClaims(question, sources);

  // Check every claim at the same time instead of one after another.
  const claims = await Promise.all(drafted.map((c) => checkClaim(c, sources)));

  const count = (v: Verdict) => claims.filter((c) => c.verdict === v).length;

  return {
    question,
    sources,
    claims,
    stats: {
      total: claims.length,
      supported: count("supported"),
      partial: count("partial"),
      unsupported: count("unsupported"),
      ms: Date.now() - start,
    },
  };
}
