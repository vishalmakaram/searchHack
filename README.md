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
