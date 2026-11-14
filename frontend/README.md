# Sentinel frontend

The control surface for Sentinel. You describe something to watch on the web in one sentence; Sentinel proposes search queries, compiles a processing script, receives results from Telem on a webhook, and shows you what the pipeline is doing.

The real backend (compiler, script runtime, Telem connector) is being built by other teams. **This app runs on mock data and a simulated runtime.** Only the webhook receiver is real: it accepts real HTTP requests. `PLAN.md` describes the design and the boundary the real backend will replace.

## Run it

Needs Node 22 or newer.

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:3000>. The first request creates `.data/db.json` with sample data. That file is the whole database; it is git-ignored. To start again from the sample data, use **Reset demo data** at the bottom of the sidebar, or:

```bash
curl -X POST http://localhost:3000/api/dev/reset
```

## Walk through it

1. **Workspaces → New workspace.** Type a sentence and submit. The workspace compiles for about four seconds, then shows proposed queries.
2. Edit the queries if you like, then **Approve**. This creates a script with the status *Developed*.
3. Open the script and **Deploy** it. It becomes *Active*.
4. **Webhooks → New webhook.** Route it to that script.
5. On the webhook page, **Send test event**. A delivery appears in the log, its runs move from queued to running to a final state, and the Overview page updates.
6. **Deactivate** the script and send another test event. The delivery is logged and the event is skipped, with the reason shown.

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

The receiver answers `{ "ok": true, "delivery_id": "dlv_..." }`. Other answers: 404 for an unknown webhook, 403 if the webhook is disabled, 413 if the body is over 1 MB.

- An `agent.changes` body produces one event for each item in `changes`.
- Any other body is stored as it is and counted as one event.
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

Webhook pages then show URLs on that address. Give a webhook's URL and secret to Telem when you create the monitor. `.env.local` is git-ignored.

## Known gaps

- **Signatures are not verified.** Every delivery is accepted and marked *Not checked*. Telem's signature header and algorithm are not known to us yet; the check lives in `lib/server/verify.ts`.
- **The `vendor.items` body shape is not documented.** It is stored raw and counted as one event.
- **Nothing sends results onward.** Output integrations (Telegram, Slack and so on) are out of scope for this app.

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
| `lib/api.ts`, `lib/types.ts` | The boundary the real backend replaces. Pages call only `lib/api.ts`. |
| `lib/server/` | The mock domain logic and the JSON-file store. |
