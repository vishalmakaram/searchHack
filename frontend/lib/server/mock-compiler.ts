// Stands in for the compiler agent. Everything here is canned: queries come
// from templates around the intent's main subject, the schema from keyword
// rules, and the script source from a fixed template.

import type { Frequency, Script, Workspace } from "@/lib/types";
import { now } from "./clock";
import { newId } from "./ids";
import { cleanText, hashString } from "./util";

/** Compilation "takes" this long: a new workspace reads "compiling" until then. */
export const COMPILE_MS = 4000;

export const DEFAULT_PROVIDERS = ["brave", "exa", "tavily"];

export interface Compilation {
  name: string;
  queries: string[];
  frequency: Frequency;
  escalationProviders: string[];
  extractionSchema: Record<string, string>;
}

/** Everything the compiler proposes for an intent. */
export function compileIntent(intent: string): Compilation {
  return {
    name: deriveName(intent),
    queries: proposeQueries(intent),
    frequency: proposeFrequency(intent),
    escalationProviders: [...DEFAULT_PROVIDERS],
    extractionSchema: proposeSchema(intent),
  };
}

// ------------------------------------------------------------------ Subject

const LEAD_INS: RegExp[] = [
  /^(?:please\s+)?(?:can you\s+)?(?:tell|let|alert|notify|ping|warn|email|message|inform)\s+(?:me|us)(?:\s+know)?\s+(?:as soon as|whenever|when|if|about|of)\s+/i,
  /^(?:i|we)\s+(?:want|would like|need)\s+to\s+(?:know|hear|be (?:notified|alerted|told))\s+(?:about|when|whenever|if)?\s*/i,
  /^(?:please\s+)?(?:keep (?:an eye on|track of|tabs on)|watch out for|look out for|watch for|watch|monitor|track|follow)\s+/i,
  /^(?:any|all|every|the|a|an)\s+/i,
];

const CLAUSE_BREAKS =
  /\s+(?:and (?:then )?(?:tell|let|alert|notify|ping|send|email)|so (?:that )?|in order to|because)\b|[;:()—–]|\.\s|,\s+(?:and|then|so)\b/i;

const STOPWORDS = new Set(
  (
    "a an the of on in for to and or any some when whenever if is are be been being new about me my us our i we " +
    "that this these those with by at from as it its there their them they what which who how get gets got has " +
    "have had do does did will would should could can may might please just also every each all other than then " +
    "so such up out into over under via per there's it's"
  ).split(" "),
);

/** The intent with lead-ins ("tell me when", "watch") and trailing clauses removed. */
export function mainSubject(intent: string): string {
  let subject = cleanText(intent).replace(/[.!?]+$/, "");
  for (let changed = true; changed; ) {
    changed = false;
    for (const pattern of LEAD_INS) {
      const next = subject.replace(pattern, "");
      if (next !== subject && next.trim() !== "") {
        subject = next.trim();
        changed = true;
      }
    }
  }
  const cut = CLAUSE_BREAKS.exec(subject);
  if (cut && cut.index > 0) subject = subject.slice(0, cut.index);
  return subject.trim() || cleanText(intent);
}

/** Subject words without stopwords, at most ten. */
function keywordList(subject: string): string[] {
  const words = subject
    .split(" ")
    .map((w) => w.replace(/^[^\w"]+|[^\w"]+$/g, ""))
    .filter((w) => w !== "" && !STOPWORDS.has(w.toLowerCase()));
  return (words.length > 0 ? words : subject.split(" ")).slice(0, 10);
}

/** Runs of capitalised words or acronyms, in order: "Acme Cloud", "EU AI Act". */
function properNouns(subject: string): string[] {
  return (subject.match(/(?:\b[A-Z][\w&'.-]*(?:\s+|$))+/g) ?? []).map((r) => r.trim()).filter((r) => r.length > 1);
}

/**
 * The entity the intent is about: the first proper noun, unless that is a lone
 * adjective such as "European" and a better one follows.
 */
function anchorOf(nouns: string[]): string | null {
  const adjective = /^[A-Z][a-z]+(?:an|ean|ese|ish|ic)$/;
  const first = nouns.find((n, i) => !(adjective.test(n) && i < nouns.length - 1));
  return first ?? null;
}

// ------------------------------------------------------------------ Outputs

/** A short editable label: the subject's first few words, capitalised. */
export function deriveName(intent: string): string {
  const words = mainSubject(intent).split(" ").slice(0, 7);
  while (words.length > 1 && STOPWORDS.has(words[words.length - 1].toLowerCase())) words.pop();
  const name = words.join(" ").replace(/[,;:]+$/, "");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** 3 to 5 search queries built from templates around the subject. */
export function proposeQueries(intent: string, year: number = now().getUTCFullYear()): string[] {
  const subject = mainSubject(intent);
  const words = keywordList(subject);
  const kw = words.join(" ");
  const nouns = properNouns(subject);
  const anchor = anchorOf(nouns);

  // What is being watched about the anchor: the topic words (not part of any
  // proper noun), plus the next proper noun if the topic alone is thin.
  let focus = "";
  if (anchor) {
    const inNouns = new Set(nouns.flatMap((n) => n.split(" ")));
    const topic = words.filter((w) => !inNouns.has(w)).slice(-3);
    const next = nouns.find((n) => n !== anchor && !(anchor.includes(n) || n.includes(anchor)));
    focus = [...topic, ...(topic.length < 2 && next ? [next] : [])].join(" ");
  }
  const about = anchor ? cleanText(`${anchor} ${focus}`) : kw;

  const candidates = [
    kw,
    anchor ? cleanText(`"${anchor}" ${focus}`) : `${kw} news`,
    `${kw} latest news`,
    `${about} ${year}`,
    `${about} announcement`,
    `${kw} official statement`,
  ];
  const unique = [...new Map(candidates.map((q) => [q.toLowerCase(), cleanText(q)])).values()];
  const count = 3 + (hashString(cleanText(intent).toLowerCase()) % 3);
  return unique.slice(0, Math.max(3, Math.min(count, unique.length)));
}

export function proposeFrequency(intent: string): Frequency {
  const text = intent.toLowerCase();
  if (/\b(hourly|real[- ]?time|immediately|as soon as|breaking|outages?|down)\b/.test(text)) return "1h";
  if (/\b(price|pricing|prices|stock|status|availability)\b/.test(text)) return "6h";
  if (/\b(weekly|each week|every week|monthly)\b/.test(text)) return "7d";
  return "1d";
}

const BASE_SCHEMA: Record<string, string> = {
  title: "string — headline of the page or change",
  summary: "string — one sentence on what changed",
  source_url: "string — URL of the page",
  published_at: "string — ISO 8601 date, or null if unknown",
};

const TOPIC_SCHEMAS: { pattern: RegExp; fields: Record<string, string> }[] = [
  {
    pattern: /\b(price|prices|pricing|cost|plan|plans|subscription)\b/,
    fields: {
      vendor: "string — company name",
      plan: "string — plan name",
      old_price: "number — price before the change",
      new_price: "number — price after the change",
      currency: "string — ISO 4217 code",
    },
  },
  {
    pattern: /\b(fine|fines|fined|penalt\w*|enforcement|regulat\w*|sanction\w*|law|act|ban|banned)\b/,
    fields: {
      authority: "string — the regulator or court that acted",
      company: "string — the organisation subject to the action",
      action: "string — fine, order, warning or ban",
      penalty_amount: "number or null — the fine, if any",
      currency: "string — ISO 4217 code",
    },
  },
  {
    pattern: /\b(hire|hires|hiring|job|jobs|role|roles|position|positions|career|careers|opening|openings)\b/,
    fields: {
      company: "string — the employer",
      role: "string — job title",
      location: "string — city, country or remote",
      seniority: "string — e.g. junior, senior, staff",
    },
  },
  {
    pattern: /\b(fund\w*|raise[sd]?|raising|investment|round|acqui\w*|ipo)\b/,
    fields: {
      company: "string — the company raising or being acquired",
      amount: "number — amount in the stated currency",
      currency: "string — ISO 4217 code",
      round: "string — e.g. seed, series A, acquisition",
      investors: "string[] — named investors or acquirers",
    },
  },
  {
    pattern: /\b(release[sd]?|launch\w*|version|model|models|ships?|announce\w*)\b/,
    fields: {
      product: "string — product or model name",
      version: "string — version label, if stated",
      release_date: "string — ISO 8601 date",
    },
  },
  {
    pattern: /\b(paper|papers|research|study|studies|arxiv|preprint)\b/,
    fields: {
      authors: "string[] — author names",
      venue: "string — journal, conference or preprint server",
      topic: "string — what the paper is about",
    },
  },
];

/** Field name -> type description. Always has the base fields, plus any topic that matches. */
export function proposeSchema(intent: string): Record<string, string> {
  const text = intent.toLowerCase();
  const schema: Record<string, string> = { ...BASE_SCHEMA };
  let topics = 0;
  for (const topic of TOPIC_SCHEMAS) {
    if (topics === 2) break;
    if (!topic.pattern.test(text)) continue;
    for (const [field, type] of Object.entries(topic.fields)) schema[field] ??= type;
    topics++;
  }
  return schema;
}

// ------------------------------------------------------------------- Script

export interface BuildScriptOptions {
  version?: number;
  at?: Date;
}

/** A freshly compiled, never-deployed script for an approved workspace. */
export function buildScript(workspace: Workspace, options: BuildScriptOptions = {}): Script {
  const version = options.version ?? 1;
  const at = (options.at ?? now()).toISOString();
  const fields = Object.keys(workspace.extractionSchema);
  const name = `${workspace.name} extractor`;
  return {
    id: newId("scr"),
    workspaceId: workspace.id,
    name,
    description:
      fields.length > 0
        ? `Extracts ${listPhrase(fields)} from pages found by the "${workspace.name}" queries.`
        : `Processes pages found by the "${workspace.name}" queries.`,
    version,
    status: "developed",
    source: scriptSource(workspace, name, version),
    extractionSchema: { ...workspace.extractionSchema },
    createdAt: at,
    deployedAt: null,
    statusChangedAt: at,
  };
}

function listPhrase(items: string[]): string {
  const shown = items.slice(0, 4);
  const rest = items.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} and ${rest} more field${rest === 1 ? "" : "s"}`;
  if (shown.length === 1) return shown[0];
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

function scriptSource(workspace: Workspace, name: string, version: number): string {
  const py = (value: string) => JSON.stringify(value);
  const schemaLines = Object.entries(workspace.extractionSchema)
    .map(([field, type]) => `    ${py(field)}: ${py(type)},`)
    .join("\n");
  const queryLines = workspace.queries.map((q) => `    ${py(q.text)},`).join("\n");
  return `# ${name} — v${version}
# Workspace: ${workspace.name} (${workspace.id})
# Intent: ${cleanText(workspace.intent)}
#
# Generated by the Sentinel compiler. Read-only: recompile the workspace to change it.

from sentinel.runtime import ChangeEvent, ProcessedResult, extract, fingerprint

PIPELINE_VERSION = "v${version}"

SCHEMA = {
${schemaLines}
}

# The searches that produce this script's events; used as extraction hints.
QUERIES = [
${queryLines}
]


def process(event: ChangeEvent) -> ProcessedResult:
    """Turn one changed page into one structured result that matches SCHEMA."""
    fields = extract(
        text=event.page_text,
        schema=SCHEMA,
        hints=QUERIES,
        source_url=event.url,
    )
    fields.validate(SCHEMA)  # raises SchemaMismatch, reported as "invalid"

    return ProcessedResult(
        workspace_id=event.workspace_id,
        seq=event.seq,
        extracted=fields.values,
        confidence=fields.confidence,
        dedupe_key=f"{event.workspace_id}:{fingerprint(event.url, fields.values)}",
        raw_ref=f"telem/{event.telem_run_id}#seq={event.seq}",
        pipeline_version=PIPELINE_VERSION,
    )
`;
}
