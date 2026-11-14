# searchHack
Improving AI-powered search under the hood.

**Consensus search:** ask several search engines at once through [Telem](https://telem.ai), merge their rankings with reciprocal rank fusion so pages that several engines agree on rise to the top, and measure with a test set whether that beats any single engine.

| File | What it does |
|---|---|
| `consensus/engines.py` | `search_all(question)`: one Telem call to exa, tavily and brave (full page content on); raw responses cached in `cache/` |
| `consensus/fuse.py` | Reciprocal rank fusion: score = sum of 1 / (60 + rank); URLs normalized before matching |
| `eval/questions.json` | Test questions with `answer_terms` that must appear in a correct page (FAA starters, unverified) |
| `eval/run_eval.py` | hit@3, hit@5 and top-3 word count for each engine and for consensus; saves `eval/results.json` |
| `app.py` | Streamlit demo: each engine's top 5 side by side, then the consensus top 5 with agreement tags |

The earlier Next.js prototype lives in `legacy-nextjs/`.

## Setup (Python 3.12+)

```bash
uv venv --python 3.12 .venv        # or: python3.12 -m venv .venv
uv pip install --python .venv/bin/python -r requirements.txt
echo "TELEM_API_KEY=..." > .env     # never commit this file
```

## Run

```bash
.venv/bin/python eval/questions.py   # check the question file
.venv/bin/python eval/run_eval.py    # run the eval
.venv/bin/streamlit run app.py       # open the demo
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

Both agents run on `openrouter/deepseek/deepseek-v4.1-flash-1017` (override with `PI_MODEL`).

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
.venv/bin/python tools/fake_integrations.py              # :4096 stub until the real proxy lands
./demo.sh "Telem AI changelog new features" https://docs.telem.ai/resources/changelog/
```

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
