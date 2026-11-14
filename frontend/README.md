# Sentinel frontend

The control surface for Sentinel. You describe something to watch on the web in one sentence; the Sentinel runtime searches for real pages, has an agent write a script (`process.py`) that reads them, and runs pages through it. This app shows the builds, scripts, runs and results, and receives Telem's webhooks.

It talks to two Python services at the repository root. There is no authentication; this is a prototype, so keep everything on localhost.

| Service | Default address | What it does |
|---|---|---|
| Sentinel runtime (`sentinel/server.py`) | `http://127.0.0.1:8000` | Builds workspaces, runs pages, streams live events on `/ws` |
| Output service (`output_integration/server.py`) | `http://127.0.0.1:4096` | Receives results; keeps alerts and the research document |

## Run it

Needs Node 22 or newer, Python with `uv`, and for real builds and runs: the `pi` agent CLI and a Telem key.

```bash
# 1. Python services, from the repository root
uv venv && uv pip install -r requirements.txt
mkdir -p bin && ln -sf "$(command -v uv)" bin/uv        # the runtime calls bin/uv
echo 'TELEM_API_KEY=...' > .env                          # needed to build and run; never commit it
HOST=127.0.0.1 PYTHONPATH=. .venv/bin/python -m sentinel.server &
PYTHONPATH=. .venv/bin/python -m output_integration.server &

# 2. This app
cd frontend
npm install
npm run dev
```

Open <http://localhost:3000>. The Overview page shows whether both services are reachable. Without `pi` and `TELEM_API_KEY` the app still runs and shows existing workspaces and results, but new builds and runs fail in the runtime.

Settings, in `frontend/.env.local` (all optional):

| Variable | Default | Meaning |
|---|---|---|
| `SENTINEL_URL` | `http://127.0.0.1:8000` | The runtime, as the server reaches it |
| `SENTINEL_OUTPUT_URL` | `http://127.0.0.1:4096` | The output service |
| `SENTINEL_WORKSPACES_DIR` | `../workspaces` | Where the runtime keeps workspaces; `process.py` is read from here |
| `NEXT_PUBLIC_SENTINEL_WS` | `ws://<this host>:8000/ws` | The live event stream, as the browser reaches it |
| `PUBLIC_BASE_URL` | the request origin | Public address shown in webhook URLs (a tunnel) |

The app keeps a small store of its own in `.data/db.json` (git-ignored): each script's switch, the webhooks, the deliveries they received, and the run log. **Clear local data** in the sidebar empties it; workspaces in the runtime are not touched.

## Walk through it

1. **Workspaces → New workspace.** Type a sentence and submit. The workspace page shows the build live: search, fetch, write, check. It takes one to three minutes.
2. When it is *Ready*, open its script. Try it on a page with **Run page**: the runtime fetches the page, runs the script, and a delivery agent records the result. The run appears under Recent runs and each step under Live activity.
3. **Deploy** the script. It becomes *Active*. **Collect now** asks Telem what is new and runs the new pages.
4. **Webhooks → New webhook.** Route it to the script. Paste the signing secret Telem issued for the monitor.
5. On the webhook page, **Send test event** with a page address. A delivery appears in the log and the page runs for real.
6. The workspace page shows what came out: alerts (sent and held back), the research document, and the agent's memory.

Runs go through the runtime one at a time, after the request that created them has been answered.

## Script statuses

| Status | Meaning |
|---|---|
| Developed | Compiled but never deployed. Receives nothing. |
| Active | Deployed and switched on. Receives events. |
| Inactive | Was deployed, now switched off. Receives nothing. |

A script moves from Developed to Active (Deploy), Active to Inactive (Deactivate), and Inactive to Active (Reactivate). It never returns to Developed.

## Post to a webhook with curl

Each webhook has its own address, shown on its page: `/api/hooks/{id}`. The body can be any JSON. The `Telem-Webhook-Type` header says which kind of delivery it is.

```bash
curl -X POST 'http://localhost:3000/api/hooks/wh_REPLACE_ME' \
  -H 'Content-Type: application/json' \
  -H 'Telem-Webhook-Type: agent.changes' \
  -d '{
    "type": "agent.changes",
    "monitor_id": "mon_demo",
    "changes": [
      { "seq": 9001, "kind": "entity_added", "url": "https://example.com/news/1" }
    ],
    "next_cursor": 9002,
    "watermark": 9001
  }'
```

The receiver answers `{ "ok": true, "delivery_id": "dlv_..." }`. Other answers: 401 for a wrong signature, 404 for an unknown webhook, 403 if the webhook is disabled, 413 if the body is over 1 MB.

- An `agent.changes` body produces one event for each item in `changes`.
- Any other body is stored as it is and counted as one event.
- Each event that names a page (`url`) is run by every active script the webhook routes to. Events without one are counted and skipped.
- Signatures: Telem sends `Telem-Signature: t=<unix>,v1=<hex>`, an HMAC-SHA256 of `<t>.<raw body>` with the monitor's secret. With a secret saved, a wrong signature is refused. A request with no signature header is accepted and marked *Not checked*.
- Posting a `seq` the webhook has already seen is recorded as a duplicate and does not run again. Change the `seq` values to send the example twice.

## Let Telem reach it

Telem needs a public address. Start a tunnel to the dev server:

```bash
cloudflared tunnel --url http://localhost:3000
```

Put the address it prints in `frontend/.env.local` and restart `npm run dev`:

```bash
PUBLIC_BASE_URL=https://your-tunnel.trycloudflare.com
```

Webhook pages then show URLs on that address. Give the webhook's URL to Telem when you create the monitor, and paste the secret Telem returns into the webhook page. `.env.local` is git-ignored.

## Known gaps

- **The runtime has no delete, rename or edit.** Workspaces cannot be removed or changed from here.
- **Unsigned requests are accepted.** That keeps curl and the test button working; tighten it before exposing the receiver beyond a demo.
- **Run history is local.** The runtime does not store runs, so the log only holds runs started through this app.
- **The `vendor.items` body shape is not documented.** It is stored raw; items with a `url` are run.

## Checks

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

## Layout

| Path | What it holds |
|---|---|
| `app/` | Pages. Each `page.tsx` renders one client component beside it. |
| `app/api/` | Route handlers. Thin: validate, call `lib/server`, return JSON. |
| `components/` | The shell, the UI kit, and the status badges. |
| `lib/api.ts`, `lib/types.ts` | The boundary between pages and server. Pages call only `lib/api.ts`. |
| `lib/backend/` | Clients for the two Python services. |
| `lib/server/` | Domain logic: workspaces, scripts, the run queue, webhook ingest, the JSON-file store. |
| `lib/events.ts`, `lib/use-event-stream.ts` | The runtime's live WebSocket events. |
