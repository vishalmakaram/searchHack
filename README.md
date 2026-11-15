# searchHack — Consensus Search & Sentinel Autonomous Intelligence

Improving AI-powered search under the hood for **SearchHack 2026**.

This repository contains two complementary systems powering next-generation search:
1. **Consensus Search Engine:** Multi-provider reciprocal rank fusion (RRF) and evaluation benchmark.
2. **Sentinel Output & Delivery Service:** Autonomous monitoring, noise suppression, living research ledger, and multi-channel alerting (Telegram, Slack, Discord, WhatsApp).

---

## 1. Consensus Search & Evaluation

Ask several search engines at once through [Telem AI](https://telem.ai), merge their rankings with reciprocal rank fusion so pages that several engines agree on rise to the top, and measure whether consensus retrieval beats any single engine.

| Component | What it does |
|---|---|
| `consensus/engines.py` | `search_all(question)`: One Telem call to exa, tavily, and brave (cached in `cache/`) |
| `consensus/fuse.py` | Reciprocal rank fusion: score = sum of 1 / (60 + rank); URLs normalized |
| `eval/questions.json` | Test questions with `answer_terms` that must appear in verified pages |
| `eval/run_eval.py` | hit@3, hit@5 and word count benchmarks; outputs `eval/results.json` |
| `app.py` | Streamlit demo: each engine's top 5 side by side + consensus ranking |
| `frontend/` | Next.js web application interface |

### Run Consensus Search & Eval
```bash
python -m pip install -r requirements.txt
python eval/run_eval.py
streamlit run app.py
```

---

## 2. Sentinel Output Integration Server

Consumes validated findings (`ProcessedResult`), applies noise suppression (confidence gates, quiet hours, rate-limiting, and deduplication), maintains an append-only living research report (`LIVING_RESEARCH.md`), and pushes verified alerts to human channels.

### Start Local Server (Port 4096)
```powershell
python -m pip install -r requirements.txt
python -m output_integration.server
```
Visit **[http://127.0.0.1:4096/](http://127.0.0.1:4096/)** in your browser for the interactive live console. OpenAPI docs are available at `http://127.0.0.1:4096/docs`.

### Main Agent-to-Output Contract (Contract 3)
Section C sends a `ProcessedResult` to `POST /api/v1/delivery/events`:
```json
{
  "workspace_id": "demo_ws",
  "seq": 1,
  "extracted": {
    "event_type": "pricing_change",
    "impact": "high",
    "summary": "Vendor raised its enterprise price",
    "source_url": "https://example.com/pricing",
    "extra_data": {"old_price": 100, "new_price": 120}
  },
  "confidence": 0.92,
  "dedupe_key": "vendor-pricing-change-1",
  "raw_ref": "telem://runs/demo/1"
}
```

### Supported Alert Channels & Variables

| Channel | Required Variables | Outbound Mechanism |
| --- | --- | --- |
| `telegram` | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Telegram Bot API `sendMessage` |
| `slack` | `SLACK_WEBHOOK_URL` | Incoming Webhook (BlockKit) |
| `discord` | `DISCORD_WEBHOOK_URL` | Discord Webhook (Rich Embeds) |
| `whatsapp` | `WHATSAPP_WEBHOOK_URL` | Gateway Webhook |
| `webhook` | `GENERIC_WEBHOOK_URL` | Generic JSON POST |

---

## 3. Test Suite

Run the full automated test suite:
```powershell
python -m unittest discover -s tests -v
```

---

## Sentinel runtime (`sentinel/`)

A monitored query becomes a workspace with its own Python env, its own extractor, and its own
delivery agent.

| Step | What happens |
|---|---|
| `POST /workspaces {"query": "..."}` | Creates `workspaces/<slug>/`, a `uv` venv, runs a **builder agent** (`pi`) that sees a real max-tier Telem search plus a real fetched page and writes `process.py`, then verify-runs it and repairs once if it fails |
| `process.py` | stdin: `{query,url,title,content,content_format}` → stdout: `{keep, processed, data}`. Stdlib only, no network, deterministic |
| `POST /workspaces/<id>/run {"url": "..."}` | Telem fetch → `process.py` in the workspace venv → **worker agent** (`pi`, no web tools) which appends to `memory.md` and calls an integration on `http://127.0.0.1:4096` when one matches |
| `POST /workspaces/<id>/collect` | Creates a Telem monitor for the query and polls it; each page it has not seen before runs through the same pipeline. A monitor with no snapshot yet polls empty, so `collect` escalates to an `extended` search for the same query and reports `source: "escalation"` instead of "monitor" |
| `GET /workspaces/<id>` | status, build steps, `memory.md` |

A successful build does three things without further prompting: it stores `process.py`, it
creates the Telem monitor for the query, and it immediately runs one collect (search → fetch →
extract → deliver) so the workspace has real pages the moment the build lands. Each processed
page is recorded in `status.json` under `pages` as `{url, title, chars_in, chars_out, ratio,
saved_pct, keep, ok, seconds}`, and the same numbers ride the WebSocket stream as `run` events
(`{"phase":"processed","chars_in":23267,"chars_out":691,"ratio":33.7,"saved_pct":97}`).

Later collects read `GET /v1/monitors/{id}/agent/changes` — the monitor agent's `entity_added`
entries carry the URLs it found — and only fall back to `/poll` (a one-shot snapshot that is
empty once the agent has seen a page) and then to an escalation search.

Both agents run on `openrouter/deepseek/deepseek-v4.1-flash-1017` (override with `PI_MODEL`),
under a hard tool-call budget the harness enforces by killing the process: the builder is asked
to finish in 15-20 calls and is stopped at **24**, a repair pass at **8**, the worker at **14**.
A killed agent fails verification, so the extractor is never left half-written silently.

### Setup

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh    # bin/uv is gitignored, uv must be on PATH
echo 'TELEM_API_KEY=tlm_...' > .env                # gitignored; router.telem.ai
uv venv --python 3.14 && uv pip install -r requirements.txt
```

`pi` (≥1.5) must be on `PATH` with a model in its catalog; the runtime shells out to
`pi -p --mode json`. `GET /` serves the status dashboard (WebSocket-driven), `HOST` defaults to
`0.0.0.0` so it is reachable over tailscale/LAN, `PORT` to 8000.

```bash
PYTHONPATH=. .venv/bin/python -m sentinel.server          # :8000, dashboard at /
PYTHONPATH=. .venv/bin/python -m uvicorn output_integration.server:app \
    --host 0.0.0.0 --port 4096                          # :4096 real output service
.venv/bin/python tools/fake_integrations.py             # optional stub if 4096 is absent
./demo.sh "Telem AI changelog new features" https://docs.telem.ai/resources/changelog/

cd frontend && npm ci && npx next dev -H 0.0.0.0 -p 3000   # :3000 control surface
```

Full stack: **3000** frontend (Next, talks to 8000 and 4096 server-side, browser opens a
WebSocket straight to 8000), **8000** runtime, **4096** output service — all bound to `0.0.0.0`.

### Live status over WebSocket

`ws://127.0.0.1:8000/ws` streams one JSON object per frame, and replays the last 80 events on
connect so a frontend opened mid-build still sees the history.

| `type` | `phase` values | Carries |
|---|---|---|
| `workspace` | `created` | `workspace`, `query` |
| `build` | `search`, `searched`, `fetch`, `write`, `verify`, `repair`, `ready`, `failed` | `workspace`, `urls`, `sample`, `seconds`, `error` |
| `agent` | — | `agent` (`builder`/`worker`), `workspace`, `line` — every line the pi process prints |
| `run` | `fetch`, `fetched`, `processed`, `dropped`, `unchanged` | `workspace`, `url`, `title`, `duration_ms`, `keep`, `processed`, `fingerprint` |
| `delivery` | `start`, `done` | `workspace`, `integrations`, `ok`, `seconds`, `reply` |
| `collect` | `polled`, `new_items` | `workspace`, `monitor_id`, `source`, `count`, `urls` |

```js
const ws = new WebSocket("ws://127.0.0.1:8000/ws");   // one JSON event per frame
```
