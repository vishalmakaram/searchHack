// A believable starting state, relative to the moment it is built:
// 2 workspaces, 4 scripts (2 active, 1 inactive, 1 developed), 2 webhooks,
// 15 deliveries and 30 finished runs over the last day, a few of them failed
// or invalid. All names, companies and URLs are fictional (.example domains).

import type { ChangeEvent } from "@/lib/contracts";
import type { Delivery, Run, Script, Webhook, Workspace } from "@/lib/types";
import { newId, newSecret, randomString } from "./ids";
import { buildScript, DEFAULT_PROVIDERS } from "./mock-compiler";
import { createRun, type RunOutcome } from "./runtime";
import type { Db } from "./store";
import { DAY, HOUR, iso, MINUTE, pick, seededRandom } from "./util";

/** Minutes before `at` of each delivery, oldest first. Even ones go to webhook 1, odd ones to webhook 2. */
const DELIVERY_MINUTES_AGO = [1380, 1295, 1190, 1060, 965, 850, 735, 610, 505, 400, 310, 215, 125, 55, 18];
/** Events in each delivery; 30 in all, so 30 runs. */
const EVENTS_PER_DELIVERY = [2, 2, 3, 1, 2, 2, 1, 2, 3, 2, 2, 2, 2, 2, 2];
/** This delivery also repeats the previous pricing change, which ingest drops as a duplicate. */
const REDELIVERY_INDEX = 9;
/** Run numbers (in creation order) that did not succeed. None are in the last hour. */
const PROBLEM_RUNS: Record<number, RunOutcome> = { 3: "invalid", 9: "failed", 14: "invalid", 18: "failed", 21: "invalid" };

export function buildSeed(at: Date): Db {
  const t = at.getTime();
  const random = seededRandom(20261114);

  // ------------------------------------------------------------ Workspaces
  const aiAct: Workspace = workspace({
    name: "EU AI Act enforcement",
    intent: "Tell me when a European regulator announces an enforcement action or fine under the EU AI Act.",
    queries: [
      "EU AI Act enforcement action",
      '"AI Act" fine regulator announcement',
      "AI Act penalty decision 2026",
      "national AI authority sanction AI Act",
    ],
    frequency: "6h",
    escalationProviders: [...DEFAULT_PROVIDERS],
    extractionSchema: {
      authority: "string — the regulator that acted",
      company: "string — the organisation subject to the action",
      action: "string — fine, order, warning or ban",
      penalty_eur: "number or null — the fine in euros",
      decision_date: "string — ISO 8601 date",
      summary: "string — one sentence on what happened",
    },
    createdAt: t - 9 * DAY,
  });
  const pricing: Workspace = workspace({
    name: "Competitor pricing",
    intent: "Watch the public pricing pages of Acme Cloud and Northwind Hosting and tell me when a plan price changes.",
    queries: ["Acme Cloud pricing", "Northwind Hosting pricing plans", "Acme Cloud price change", "Northwind Hosting plan price update"],
    frequency: "1d",
    escalationProviders: ["brave", "exa"],
    extractionSchema: {
      vendor: "string — company name",
      plan: "string — plan name",
      old_price: "number — monthly price before the change",
      new_price: "number — monthly price after the change",
      currency: "string — ISO 4217 code",
      effective_date: "string — ISO 8601 date",
    },
    createdAt: t - 14 * DAY,
  });

  // --------------------------------------------------------------- Scripts
  const aiActLive = script(aiAct, { version: 2, status: "active", createdAt: t - 6 * DAY, deployedAt: t - 6 * DAY + 20 * MINUTE });
  const aiActNext = script(aiAct, {
    version: 3,
    status: "developed",
    createdAt: t - 3 * HOUR,
    deployedAt: null,
    description: "Adds currency normalisation for fines reported outside the euro area. Not yet deployed.",
  });
  const pricingOld = script(pricing, {
    version: 1,
    status: "inactive",
    createdAt: t - 14 * DAY + 5 * MINUTE,
    deployedAt: t - 14 * DAY + 15 * MINUTE,
    statusChangedAt: t - 4 * DAY,
  });
  const pricingLive = script(pricing, {
    version: 2,
    status: "active",
    createdAt: t - 4 * DAY - 2 * HOUR,
    deployedAt: t - 4 * DAY,
  });
  aiAct.scriptId = aiActLive.id;
  aiAct.approvedAt = iso(t - 9 * DAY + 12 * MINUTE);
  pricing.scriptId = pricingLive.id;
  pricing.approvedAt = iso(t - 14 * DAY + 5 * MINUTE);

  // -------------------------------------------------------------- Webhooks
  const aiActHook: Webhook = {
    id: newId("wh"),
    name: "AI Act monitor",
    secret: newSecret(),
    enabled: true,
    scriptIds: [aiActLive.id],
    createdAt: iso(t - 6 * DAY),
  };
  // Still routed to the retired v1 as well, so its deliveries show a skip.
  const pricingHook: Webhook = {
    id: newId("wh"),
    name: "Pricing monitor",
    secret: newSecret(),
    enabled: true,
    scriptIds: [pricingLive.id, pricingOld.id],
    createdAt: iso(t - 13 * DAY),
  };

  // ---------------------------------------------------- Deliveries and runs
  const deliveries: Delivery[] = [];
  const runs: Run[] = [];
  const seq = { [aiActHook.id]: 1040, [pricingHook.id]: 310 };
  let previousPricingChange: Change | null = null;
  let runNumber = 0;

  DELIVERY_MINUTES_AGO.forEach((minutesAgo, index) => {
    const receivedAt = new Date(t - minutesAgo * MINUTE + Math.floor(random() * 50) * 1000);
    const hook = index % 2 === 0 ? aiActHook : pricingHook;
    const isAiAct = hook === aiActHook;
    const telemRunId = `trun_${randomString(10)}`;

    const fresh: Change[] = [];
    for (let i = 0; i < EVENTS_PER_DELIVERY[index]; i++) {
      seq[hook.id] += 1;
      fresh.push(isAiAct ? aiActChange(seq[hook.id], receivedAt, random) : pricingChange(seq[hook.id], receivedAt, random));
    }
    const repeated = index === REDELIVERY_INDEX && previousPricingChange ? [previousPricingChange] : [];
    if (!isAiAct) previousPricingChange = fresh[fresh.length - 1];

    const body = {
      type: "agent.changes",
      monitor_id: isAiAct ? "mon_aiact_eu" : "mon_pricing",
      run_id: telemRunId,
      changes: [...repeated, ...fresh],
      next_cursor: `cur_${seq[hook.id]}`,
      watermark: receivedAt.toISOString(),
    };
    const delivery: Delivery = {
      id: newId("dlv"),
      webhookId: hook.id,
      receivedAt: receivedAt.toISOString(),
      webhookType: "agent.changes",
      signature: "not_checked",
      isTest: false,
      bodyBytes: Buffer.byteLength(JSON.stringify(body), "utf8"),
      body,
      eventCount: body.changes.length,
      duplicateCount: repeated.length,
      runIds: [],
      skipped: isAiAct ? [] : [{ scriptId: pricingOld.id, reason: "script_not_active" }],
    };

    const target = isAiAct ? aiActLive : pricingLive;
    for (const change of fresh) {
      const event: ChangeEvent = {
        workspace_id: target.workspaceId,
        seq: change.seq,
        kind: change.kind,
        url: change.url,
        page_text: change.page_text,
        telem_run_id: telemRunId,
        received_at: delivery.receivedAt,
      };
      const run = createRun(target, event, delivery, {
        at: receivedAt,
        random,
        outcome: PROBLEM_RUNS[runNumber] ?? "succeeded",
      });
      runNumber++;
      runs.push(run);
      delivery.runIds.push(run.id);
    }
    deliveries.push(delivery);
  });

  return {
    workspaces: [pricing, aiAct],
    scripts: [pricingOld, aiActLive, pricingLive, aiActNext],
    webhooks: [pricingHook, aiActHook],
    deliveries,
    runs,
  };
}

// ------------------------------------------------------------------ Builders

function workspace(spec: {
  name: string;
  intent: string;
  queries: string[];
  frequency: Workspace["frequency"];
  escalationProviders: string[];
  extractionSchema: Record<string, string>;
  createdAt: number;
}): Workspace {
  return {
    id: newId("ws"),
    name: spec.name,
    intent: spec.intent,
    queries: spec.queries.map((text) => ({ id: newId("q"), text })),
    frequency: spec.frequency,
    escalationProviders: spec.escalationProviders,
    extractionSchema: spec.extractionSchema,
    scriptId: null,
    createdAt: iso(spec.createdAt),
    compileReadyAt: iso(spec.createdAt + 4000),
    approvedAt: null,
  };
}

function script(
  ws: Workspace,
  spec: {
    version: number;
    status: Script["status"];
    createdAt: number;
    deployedAt: number | null;
    statusChangedAt?: number;
    description?: string;
  },
): Script {
  const built = buildScript(ws, { version: spec.version, at: new Date(spec.createdAt) });
  return {
    ...built,
    status: spec.status,
    description: spec.description ?? built.description,
    deployedAt: spec.deployedAt === null ? null : iso(spec.deployedAt),
    statusChangedAt: iso(spec.statusChangedAt ?? spec.deployedAt ?? spec.createdAt),
  };
}

interface Change {
  seq: number;
  kind: ChangeEvent["kind"];
  url: string;
  title: string;
  page_text: string;
}

const AUTHORITIES = [
  "Office for AI Oversight",
  "National Digital Regulator",
  "Data and AI Supervisory Board",
  "Market Surveillance Authority for AI",
];
const COMPANIES = [
  "Novacrest AI",
  "Brightline Analytics",
  "Helio Vision",
  "Quillsoft",
  "Parallax Health",
  "Ombra Labs",
  "Tessel Robotics",
  "Kitewing",
];

function aiActChange(seq: number, at: Date, random: () => number): Change {
  const authority = pick(AUTHORITIES, random);
  const company = pick(COMPANIES, random);
  const roll = random();
  const action = roll < 0.45 ? "fine" : roll < 0.7 ? "order" : roll < 0.92 ? "warning" : "ban";
  const penalty = action === "fine" ? (5 + Math.floor(random() * 120)) * 25000 : null;
  const summary = {
    fine: `${authority} fined ${company} €${penalty?.toLocaleString("en-US")} for placing a high-risk AI system on the market without a conformity assessment.`,
    order: `${authority} ordered ${company} to stop using emotion recognition to monitor employees.`,
    warning: `${authority} issued a formal warning to ${company} over missing transparency notices on its chatbot.`,
    ban: `${authority} banned ${company}'s social-scoring feature as a prohibited practice.`,
  }[action];
  const date = new Date(at.getTime() - Math.floor(random() * 3) * DAY).toISOString().slice(0, 10);
  const title = `${authority}: decision concerning ${company}`;
  return {
    seq,
    kind: action === "ban" ? "alert" : "entity_added",
    url: `https://ai-oversight.example/decisions/2026-${seq}`,
    title,
    page_text: [
      title,
      `Authority: ${authority}`,
      `Company: ${company}`,
      `Action: ${action}`,
      `Penalty EUR: ${penalty ?? "none"}`,
      `Decision date: ${date}`,
      `Summary: ${summary}`,
    ].join("\n"),
  };
}

const VENDORS = [
  { name: "Acme Cloud", host: "acme-cloud.example" },
  { name: "Northwind Hosting", host: "northwind-hosting.example" },
];
const PLANS = [
  { name: "Starter", price: 9 },
  { name: "Team", price: 49 },
  { name: "Business", price: 199 },
  { name: "Enterprise", price: 899 },
];

function pricingChange(seq: number, at: Date, random: () => number): Change {
  const vendor = pick(VENDORS, random);
  const plan = pick(PLANS, random);
  const step = Math.max(1, Math.round(plan.price * (0.05 + random() * 0.2)));
  const newPrice = random() < 0.7 ? plan.price + step : plan.price - step;
  const effective = new Date(at.getTime() + (7 + Math.floor(random() * 21)) * DAY).toISOString().slice(0, 10);
  const title = `${vendor.name} pricing — ${plan.name} plan`;
  return {
    seq,
    kind: "value_changed",
    url: `https://${vendor.host}/pricing#${plan.name.toLowerCase()}`,
    title,
    page_text: [
      title,
      `Vendor: ${vendor.name}`,
      `Plan: ${plan.name}`,
      `Old price: ${plan.price}`,
      `New price: ${newPrice}`,
      `Currency: USD`,
      `Effective date: ${effective}`,
    ].join("\n"),
  };
}
