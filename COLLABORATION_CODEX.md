# Sentinel: Multi-Agent & Team Collaboration Guide

> **Target:** Shared between Codex, Antigravity, and engineering workstreams.  
> **Status:** Contract Frozen (Day 0) · Section D (Output Integration) Shipped and Verified.

---

## 1. Workstream Status & Owners

| Section | Mission | Owner | Status |
| :--- | :--- | :--- | :--- |
| **Shared Spine** | Contracts 1, 2, 3 + Schemas + Types | `packages/contracts` | ✅ **FROZEN & COMMITTED** |
| **Section A** | Control Plane / Frontend (Local Process Creator) | Frontend Lead | In Progress |
| **Section B** | Ingest / Telem Connector (Webhooks & Monitors) | Backend Lead (Codex) | In Progress |
| **Section C** | Pipeline Compiler + Runtime (Data Processing) | Pipeline Lead | In Progress |
| **Section D** | Output Integration (Delivery, Suppression, Living Doc) | Integration Lead | ✅ **READY & VERIFIED** |

---

## 2. Shared Spine (`packages/contracts`)

All teams must import types and validation models directly from:
```python
from packages.contracts import WorkspaceSpec, NewChangeEvent, ProcessedResult
```

### Contract 1 (A ➔ B, C): `WorkspaceSpec`
```json
{
  "workspace_id": "ws_ibm_market_radar",
  "intent": "I want to be told about IBM related events that may influence stock",
  "queries": ["IBM 8-K SEC filings", "IBM earnings guidance change"],
  "frequency": "1h",
  "escalation_providers": ["brave", "exa", "tavily"],
  "extraction_schema": {
    "event_type": "string",
    "impact": "low|medium|high",
    "summary": "string",
    "source_url": "string",
    "published_at": "string|null"
  }
}
```

### Contract 2 (B ➔ C): `NewChangeEvent`
Triggered by Telem Webhook (`agent.changes` or `vendor.items`) and passed to Section C.
```json
{
  "workspace_id": "ws_ibm_market_radar",
  "seq": 41,
  "kind": "entity_added",
  "url": "https://sec.gov/...",
  "page_text": "...",
  "telem_run_id": "run_9876",
  "received_at": "2026-11-14T13:40:00Z"
}
```

### Contract 3 (C ➔ D): `ProcessedResult`
**This is what Section C sends to Section D (Output Integration):**
```json
{
  "workspace_id": "ws_ibm_market_radar",
  "seq": 41,
  "extracted": {
    "event_type": "8-K Filing",
    "impact": "high",
    "summary": "IBM announces acquisition of cloud infrastructure provider for $1.8B.",
    "source_url": "https://sec.gov/...",
    "published_at": "2026-11-14T13:30:00Z"
  },
  "confidence": 0.95,
  "dedupe_key": "sha256_hash_of_event_content",
  "raw_ref": "telem://runs/ws_ibm/41",
  "pipeline_version": "v1"
}
```

---

## 3. How Other Services Hook Into Section D (Output Integration)

Section D can be used **in-process (Python import)** or **via HTTP microservice**:

### Path A: Python In-Process (Direct Function Call)
Used by Section C pipeline scripts:
```python
from packages.contracts import ProcessedResult
from output_integration.service import DeliveryService

service = DeliveryService()

# Ingest validated event
result = service.process_event(
    event=contract_3_result,
    workspace_intent="I want to be told about IBM related events that may influence stock"
)

print(result.delivered_to_channels) # e.g. ['slack', 'discord', 'local_feed']
print(result.added_to_research_doc) # True
print(result.suppressed)             # False (or True with suppression_reason)
```

### Path B: HTTP Microservice (FastAPI on localhost port 4096)
Start server:
```bash
python -m output_integration.server
```
For a simple channel smoke test, send `POST http://localhost:4096/api/v1/messages`
with `{"send_msg":"abc","channel":"telegram"}`. The `channel` field is optional;
without it, the server sends to every configured output. See `README.md` for
environment variables and the `sned_msg` compatibility spelling.

1. **Section C sends events:**
   `POST http://localhost:4096/api/v1/delivery/events`  
   Body: Contract-3 JSON

2. **Section A Frontend displays living report:**
   `GET http://localhost:4096/api/v1/delivery/workspaces/{workspace_id}/doc`  
   Returns `{ "workspace_id": "...", "markdown": "# Sentinel Living Research..." }`

3. **Section A Frontend displays alert feed & toasts:**
   `GET http://localhost:4096/api/v1/delivery/workspaces/{workspace_id}/alerts`  
   Returns recent delivered and suppressed alerts with confidence, timestamps, and sources.

4. **Telemetry & Suppression Metrics for Judges:**
   `GET http://localhost:4096/api/v1/delivery/workspaces/{workspace_id}/stats`  
   Returns `{ "total_received": 100, "total_alerts_delivered": 5, "total_suppressed": 95, "doc_entries": 62 }`

---

## 4. Verification

Run the verification test anytime:
```bash
python searchHack/output_integration/demo_runner.py
```
Runs 100 synthetic events in isolated storage and shows document entries, push-eligible events, and actual external deliveries separately. External delivery is zero unless a channel is configured and accepts the request.
