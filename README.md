# Sentinel local output server

The main integration accepts a structured finding from the agent pipeline and decides whether to record and alert on it. A small text-message endpoint is available for checking that an output channel works.

## Start on localhost:4096

From this directory, install dependencies and configure at least one destination:

```powershell
python -m pip install -r requirements.txt
$env:TELEGRAM_BOT_TOKEN = "your-bot-token"
$updates = Invoke-RestMethod "https://api.telegram.org/bot$($env:TELEGRAM_BOT_TOKEN)/getUpdates"
$chat = $updates.result | Where-Object { $_.message } | Select-Object -Last 1
$env:TELEGRAM_CHAT_ID = [string]$chat.message.chat.id
python -m output_integration.server
```

Create the bot with Telegram's `@BotFather`, then send your bot `/start` from your phone before running `getUpdates`. If `$chat` is empty, send the bot another message and repeat the `getUpdates` command. Keep the terminal running while testing.

The server binds to `127.0.0.1:4096`. Open `http://127.0.0.1:4096/docs` for the API form.

To discover what this server supports and which channels are configured, POST an empty JSON object:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:4096/api/v1/capabilities `
  -Method Post -ContentType application/json -Body '{}'
```

Add `"include_schemas":true` to receive the full input JSON schemas. The response lists channel readiness and required configuration names without exposing secret values.

## Main agent-to-output contract

Section C of the Sentinel pipeline sends a `ProcessedResult` to `POST /api/v1/delivery/events`. The shared model is in [`packages/contracts/models.py`](packages/contracts/models.py). It includes a workspace ID, sequence, extracted finding, impact, source URL, confidence, deduplication key, and raw reference. `extracted.extra_data` can carry additional structured fields. The output service records accepted findings in a living document and routes eligible alerts to configured channels.

Example body:

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

Use `http://127.0.0.1:4096/docs` to submit this body. Then open `GET /api/v1/delivery/workspaces/demo_ws/doc` or `GET /api/v1/delivery/workspaces/demo_ws/alerts` to inspect the local result. If the upstream agent eventually emits a different schema, adapt it to `ProcessedResult` at the pipeline boundary; the delivery service should keep one stable input contract.

## Simple channel smoke test

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:4096/api/v1/messages `
  -Method Post -ContentType application/json `
  -Body '{"send_msg":"abc","channel":"telegram"}'
```

The response is `{"delivery":{"telegram":"sent"}}` when Telegram accepts it. The example spelling `sned_msg` is also accepted. Omit `channel` to send to every configured destination. An unconfigured destination returns HTTP 503; a failed outbound request returns HTTP 502.

Supported destinations and environment variables:

| Channel | Required variables | Outbound payload |
| --- | --- | --- |
| `telegram` | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Telegram Bot API `sendMessage` |
| `slack` | `SLACK_WEBHOOK_URL` | `{"text":"..."}` |
| `discord` | `DISCORD_WEBHOOK_URL` | `{"content":"..."}` |
| `webhook` | `GENERIC_WEBHOOK_URL` | `{"send_msg":"..."}` |
| `whatsapp` | `WHATSAPP_WEBHOOK_URL` | `{"message":"..."}` to a compatible WhatsApp gateway |

The WhatsApp webhook setting needs a gateway that accepts that JSON shape; it is not a direct Meta Cloud API connection. Actual external delivery requires working credentials or webhook URLs. The local tests mock outbound requests.

## Checks

```powershell
python -m unittest discover -s tests -v
```
