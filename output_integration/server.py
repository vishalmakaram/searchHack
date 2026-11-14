"""
FastAPI HTTP Microservice for Section D (Output Integration) & Sentinel Web Console
Serves:
- REST API: /api/v1/delivery/events, /api/v1/messages, /api/v1/capabilities
- Interactive Visual Dashboard on GET / (for browser demos and live testing)
"""

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse
from typing import Optional, Dict, Any, List
import os
import json
from pydantic import BaseModel

try:
    from packages.contracts.models import ProcessedResult
    from .models import ChannelConfig, SuppressionPolicy, DeliveryResult
    from .service import DeliveryService
    from .message_service import MessageRequest, MessageDeliveryService
except ImportError:
    from searchHack.packages.contracts.models import ProcessedResult
    from searchHack.output_integration.models import ChannelConfig, SuppressionPolicy, DeliveryResult
    from searchHack.output_integration.service import DeliveryService
    from searchHack.output_integration.message_service import MessageRequest, MessageDeliveryService

try:
    from telem_connector.client import TelemClient
except ImportError:
    from searchHack.telem_connector.client import TelemClient

app = FastAPI(
    title="Sentinel Output Integration Service",
    description="Consumes Contract-3 processed events, applies suppression, updates living research docs, and pushes alerts.",
    version="1.0.0"
)

# Initialize service with environment overrides
channel_config = ChannelConfig(
    slack_webhook_url=os.getenv("SLACK_WEBHOOK_URL"),
    discord_webhook_url=os.getenv("DISCORD_WEBHOOK_URL"),
    generic_webhook_url=os.getenv("GENERIC_WEBHOOK_URL"),
    telegram_bot_token=os.getenv("TELEGRAM_BOT_TOKEN"),
    telegram_chat_id=os.getenv("TELEGRAM_CHAT_ID"),
    whatsapp_webhook_url=os.getenv("WHATSAPP_WEBHOOK_URL"),
)

service = DeliveryService(channel_config=channel_config)
message_service = MessageDeliveryService(channel_config)
telem_client = TelemClient()

class CapabilitiesRequest(BaseModel):
    include_schemas: bool = False

@app.get("/")
def root(request: Request):
    """
    Returns an interactive, dark-mode Web Dashboard when viewed in a browser,
    or standard JSON when requested by API clients.
    """
    accept = request.headers.get("accept", "")
    if "text/html" in accept:
        return HTMLResponse(content=get_dashboard_html(), status_code=200)
    return {"status": "ok", "service": "sentinel-output-integration", "version": "1.0.0"}

@app.post("/api/v1/capabilities")
def get_capabilities(request: Optional[CapabilitiesRequest] = None):
    """Describe supported operations and currently configured output channels."""
    if request is None:
        request = CapabilitiesRequest()
    channels = [
        ("telegram", "Telegram Bot API", ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"]),
        ("whatsapp", "compatible WhatsApp gateway webhook", ["WHATSAPP_WEBHOOK_URL"]),
        ("slack", "Slack incoming webhook", ["SLACK_WEBHOOK_URL"]),
        ("discord", "Discord webhook", ["DISCORD_WEBHOOK_URL"]),
        ("webhook", "generic JSON webhook", ["GENERIC_WEBHOOK_URL"]),
    ]
    result = {
        "service": "sentinel-output-integration",
        "version": app.version,
        "inputs": [
            {
                "name": "processed_result",
                "method": "POST",
                "path": "/api/v1/delivery/events",
                "purpose": "Record a validated finding and route eligible alerts",
                "schema": "ProcessedResult",
            },
            {
                "name": "plain_text_test",
                "method": "POST",
                "path": "/api/v1/messages",
                "purpose": "Test a configured outbound channel with a short message",
                "schema": "MessageRequest",
            },
        ],
        "operations": [
            "confidence_filtering",
            "deduplication",
            "impact_thresholds",
            "quiet_hours",
            "hourly_rate_limit",
            "append_research_document",
            "local_alert_feed",
            "external_alert_delivery",
        ],
        "outputs": [
            {
                "name": "research_document",
                "configured": True,
                "method": "GET",
                "path": "/api/v1/delivery/workspaces/{workspace_id}/doc",
            },
            {
                "name": "local_alert_feed",
                "configured": True,
                "method": "GET",
                "path": "/api/v1/delivery/workspaces/{workspace_id}/alerts",
            },
            *[
                {
                    "name": name,
                    "configured": message_service.configured(name),
                    "transport": transport,
                    "requires": requires,
                }
                for name, transport, requires in channels
            ],
        ],
        "telemetry": {
            "method": "GET",
            "path": "/api/v1/delivery/workspaces/{workspace_id}/stats",
        },
    }
    if request.include_schemas:
        result["schemas"] = {
            "ProcessedResult": ProcessedResult.model_json_schema(),
            "MessageRequest": MessageRequest.model_json_schema(),
        }
    return result

@app.post("/api/v1/messages")
def send_agent_message(request: MessageRequest):
    """Accept a short message from a local agent and route it to integrations."""
    message = request.send_msg if request.send_msg is not None else request.sned_msg
    if not message or not message.strip():
        raise HTTPException(status_code=422, detail="send_msg must be non-empty")
    if len(message) > 4000:
        raise HTTPException(status_code=422, detail="send_msg must be at most 4000 characters")

    channels = [request.channel] if request.channel else [
        "telegram", "whatsapp", "slack", "discord", "webhook"
    ]
    configured = [channel for channel in channels if message_service.configured(channel)]
    if not configured:
        raise HTTPException(status_code=503, detail="No requested output channel is configured")

    results = {channel: ("sent" if message_service.send(message, channel) else "failed")
               for channel in configured}
    if not any(result == "sent" for result in results.values()):
        raise HTTPException(status_code=502, detail={"delivery": results})
    return {"delivery": results}

@app.post("/api/v1/delivery/events", response_model=DeliveryResult)
def receive_event(event: ProcessedResult, intent: Optional[str] = None):
    """
    Contract 3 Ingestion Endpoint:
    Called by Section C (Pipeline Compiler & Runtime) when a page is processed into a validated result.
    """
    try:
        result = service.process_event(event=event, workspace_intent=intent)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process event: {str(e)}")

@app.post("/api/v1/pipeline/search-and-deliver")
def run_live_search(query: str, workspace_id: str = "demo_ws"):
    """
    Live Demonstration Endpoint:
    Runs Telem search with auto-routing -> formats Contract 3 -> runs through Output Integration!
    """
    processed = telem_client.run_pipeline_step(workspace_id=workspace_id, query=query)
    result = service.process_event(processed)
    return {
        "telem_finding": processed.model_dump(),
        "delivery_result": result.model_dump()
    }

@app.get("/api/v1/delivery/workspaces/{workspace_id}/doc")
def get_living_doc(workspace_id: str):
    doc_content = service.get_living_doc(workspace_id)
    return {"workspace_id": workspace_id, "markdown": doc_content}

@app.get("/api/v1/delivery/workspaces/{workspace_id}/alerts")
def get_alerts(workspace_id: str, limit: int = Query(default=50, ge=1, le=200)):
    alerts = service.get_alerts(workspace_id, limit=limit)
    return {"workspace_id": workspace_id, "alerts": alerts}

@app.get("/api/v1/delivery/workspaces/{workspace_id}/stats")
def get_stats(workspace_id: str):
    stats = service.get_stats(workspace_id)
    return {"workspace_id": workspace_id, "stats": stats}

def get_dashboard_html() -> str:
    return """<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <title>Sentinel — Autonomous Web Intelligence Console</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            brand: '#3b82f6',
            surface: '#0f172a',
            panel: '#1e293b'
          }
        }
      }
    }
  </script>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen p-6 font-sans">
  <div class="max-w-7xl mx-auto space-y-6">
    
    <!-- Header -->
    <header class="flex items-center justify-between border-b border-slate-800 pb-4">
      <div class="flex items-center space-x-3">
        <div class="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/30">
          <i class="fa-solid fa-radar text-lg"></i>
        </div>
        <div>
          <h1 class="text-2xl font-bold tracking-tight">Sentinel <span class="text-blue-500">Live Console</span></h1>
          <p class="text-xs text-slate-400">Autonomous Web Search · Telem AI Auto-Router · Continuous Living Research</p>
        </div>
      </div>
      <div class="flex items-center space-x-3">
        <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <span class="w-2 h-2 mr-2 rounded-full bg-emerald-400 animate-pulse"></span> Service Online (Port 4096)
        </span>
        <a href="/docs" target="_blank" class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 transition">
          <i class="fa-solid fa-book mr-1"></i> OpenAPI Docs
        </a>
      </div>
    </header>

    <!-- Main Grid -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      
      <!-- Left Column: Controls & Actions -->
      <div class="space-y-6">
        
        <!-- Live Telem AI Search Trigger -->
        <div class="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold text-slate-200 flex items-center">
              <i class="fa-solid fa-bolt text-amber-400 mr-2"></i> Telem Search & Pipeline Trigger
            </h2>
            <span class="text-[10px] bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded border border-blue-500/20">Auto-Routing: accuracy</span>
          </div>
          <p class="text-xs text-slate-400">Run a live routed search to discover breaking changes and feed Contract 3 into the delivery engine.</p>
          
          <div class="space-y-2">
            <input type="text" id="search-query" value="IBM 8-K SEC filings and earnings guidance" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500">
            <button onclick="triggerTelemPipeline()" id="search-btn" class="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2 px-4 rounded-lg text-xs transition flex items-center justify-center space-x-2">
              <i class="fa-solid fa-magnifying-glass"></i>
              <span>Execute Telem Search & Ingest</span>
            </button>
          </div>
        </div>

        <!-- Quick Scenario Simulator -->
        <div class="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm space-y-3">
          <h2 class="text-sm font-semibold text-slate-200 flex items-center">
            <i class="fa-solid fa-vial text-purple-400 mr-2"></i> Inject Contract-3 Scenarios
          </h2>
          <p class="text-xs text-slate-400">Test how suppression, noise filtering, and deduplication react in real time:</p>
          <div class="grid grid-cols-2 gap-2">
            <button onclick="simulateScenario('guidance')" class="text-left bg-slate-950 hover:bg-slate-800 border border-slate-800 p-2.5 rounded-lg text-xs transition">
              <div class="font-bold text-red-400">🔴 High Impact</div>
              <div class="text-[11px] text-slate-400 truncate">Guidance Raised $13.5B</div>
            </button>
            <button onclick="simulateScenario('partnership')" class="text-left bg-slate-950 hover:bg-slate-800 border border-slate-800 p-2.5 rounded-lg text-xs transition">
              <div class="font-bold text-amber-400">🟡 Med Impact</div>
              <div class="text-[11px] text-slate-400 truncate">Siemens Partnership</div>
            </button>
            <button onclick="simulateScenario('routine')" class="text-left bg-slate-950 hover:bg-slate-800 border border-slate-800 p-2.5 rounded-lg text-xs transition">
              <div class="font-bold text-emerald-400">🟢 Low Impact</div>
              <div class="text-[11px] text-slate-400 truncate">Marketing Blog Post</div>
            </button>
            <button onclick="simulateScenario('duplicate')" class="text-left bg-slate-950 hover:bg-slate-800 border border-slate-800 p-2.5 rounded-lg text-xs transition">
              <div class="font-bold text-slate-400">👻 Duplicate</div>
              <div class="text-[11px] text-slate-500 truncate">Tests Dedupe Cooldown</div>
            </button>
          </div>
        </div>

        <!-- Channel Status -->
        <div class="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm space-y-3">
          <h2 class="text-sm font-semibold text-slate-200 flex items-center">
            <i class="fa-solid fa-satellite-dish text-blue-400 mr-2"></i> Active Delivery Channels
          </h2>
          <div id="channels-list" class="space-y-2 text-xs">
            <div class="flex items-center justify-between p-2 bg-slate-950 rounded-lg border border-slate-800">
              <span class="flex items-center"><i class="fa-solid fa-file-lines text-blue-400 mr-2"></i> Living Research Doc</span>
              <span class="text-emerald-400 font-mono">ACTIVE</span>
            </div>
            <div class="flex items-center justify-between p-2 bg-slate-950 rounded-lg border border-slate-800">
              <span class="flex items-center"><i class="fa-solid fa-list-check text-purple-400 mr-2"></i> Local Feed & UI</span>
              <span class="text-emerald-400 font-mono">ACTIVE</span>
            </div>
            <div class="flex items-center justify-between p-2 bg-slate-950 rounded-lg border border-slate-800 opacity-60">
              <span class="flex items-center"><i class="fa-brands fa-telegram text-sky-400 mr-2"></i> Telegram Bot</span>
              <span id="telegram-status" class="text-slate-500 font-mono">UNCONFIGURED</span>
            </div>
            <div class="flex items-center justify-between p-2 bg-slate-950 rounded-lg border border-slate-800 opacity-60">
              <span class="flex items-center"><i class="fa-brands fa-discord text-indigo-400 mr-2"></i> Discord Webhook</span>
              <span id="discord-status" class="text-slate-500 font-mono">UNCONFIGURED</span>
            </div>
          </div>
        </div>

      </div>

      <!-- Right 2 Columns: Live Alerts & Research Document -->
      <div class="lg:col-span-2 space-y-6">
        
        <!-- Live Telemetry KPI Bar -->
        <div class="grid grid-cols-4 gap-4">
          <div class="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div class="text-[11px] text-slate-400">Total Findings Ingested</div>
            <div id="stat-received" class="text-2xl font-bold text-white mt-1">0</div>
          </div>
          <div class="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div class="text-[11px] text-slate-400">Living Doc Findings</div>
            <div id="stat-doc" class="text-2xl font-bold text-blue-400 mt-1">0</div>
          </div>
          <div class="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div class="text-[11px] text-slate-400">Push Alerts Delivered</div>
            <div id="stat-alerts" class="text-2xl font-bold text-emerald-400 mt-1">0</div>
          </div>
          <div class="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div class="text-[11px] text-slate-400">Suppressed (No Noise)</div>
            <div id="stat-suppressed" class="text-2xl font-bold text-amber-400 mt-1">0</div>
          </div>
        </div>

        <!-- Feed & Document Tabs -->
        <div class="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
          <div class="flex items-center justify-between border-b border-slate-800 px-4 pt-3">
            <div class="flex space-x-4">
              <button onclick="switchTab('feed')" id="tab-feed-btn" class="pb-3 text-xs font-bold border-b-2 border-blue-500 text-blue-400">
                <i class="fa-solid fa-stream mr-1.5"></i> Live Event Stream & Telemetry
              </button>
              <button onclick="switchTab('doc')" id="tab-doc-btn" class="pb-3 text-xs font-bold border-b-2 border-transparent text-slate-400 hover:text-slate-200">
                <i class="fa-solid fa-file-contract mr-1.5"></i> Living Research Document
              </button>
            </div>
            <button onclick="refreshData()" class="text-slate-400 hover:text-slate-200 text-xs pb-3">
              <i class="fa-solid fa-rotate mr-1"></i> Refresh
            </button>
          </div>

          <!-- Feed Tab Content -->
          <div id="tab-feed" class="p-4 space-y-3 max-h-[500px] overflow-y-auto font-mono text-xs">
            <div class="text-slate-500 text-center py-8">Waiting for events... Inject a scenario or run a search.</div>
          </div>

          <!-- Living Doc Tab Content -->
          <div id="tab-doc" class="hidden p-6 max-h-[500px] overflow-y-auto prose prose-invert prose-sm max-w-none">
            <div id="doc-render">Loading document...</div>
          </div>
        </div>

      </div>

    </div>
  </div>

  <script>
    let activeWorkspace = "demo_ws";

    async function loadCapabilities() {
      try {
        const res = await fetch("/api/v1/capabilities", {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({include_schemas: false})
        });
        const data = await res.json();
        data.outputs.forEach(ch => {
          if (ch.name === "telegram" && ch.configured) {
            document.getElementById("telegram-status").innerText = "ACTIVE";
            document.getElementById("telegram-status").className = "text-emerald-400 font-mono";
            document.getElementById("telegram-status").parentElement.classList.remove("opacity-60");
          }
          if (ch.name === "discord" && ch.configured) {
            document.getElementById("discord-status").innerText = "ACTIVE";
            document.getElementById("discord-status").className = "text-emerald-400 font-mono";
            document.getElementById("discord-status").parentElement.classList.remove("opacity-60");
          }
        });
      } catch (e) {
        console.error(e);
      }
    }

    async function refreshData() {
      try {
        // Stats
        const statsRes = await fetch(`/api/v1/delivery/workspaces/${activeWorkspace}/stats`);
        const stats = await statsRes.json();
        document.getElementById("stat-received").innerText = stats.stats.total_received || 0;
        document.getElementById("stat-doc").innerText = stats.stats.doc_entries || 0;
        document.getElementById("stat-alerts").innerText = stats.stats.total_alerts_delivered || 0;
        document.getElementById("stat-suppressed").innerText = stats.stats.total_suppressed || 0;

        // Alerts Feed
        const alertsRes = await fetch(`/api/v1/delivery/workspaces/${activeWorkspace}/alerts?limit=20`);
        const alertsData = await alertsRes.json();
        const feedContainer = document.getElementById("tab-feed");
        if (alertsData.alerts && alertsData.alerts.length > 0) {
          feedContainer.innerHTML = alertsData.alerts.slice().reverse().map(a => {
            const isSuppressed = a.suppressed;
            const badgeColor = a.impact === 'high' ? 'bg-red-500/20 text-red-400 border-red-500/30' : (a.impact === 'medium' ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' : 'bg-blue-500/20 text-blue-400 border-blue-500/30');
            const statusBadge = isSuppressed ? `<span class="bg-slate-800 text-slate-400 border border-slate-700 px-2 py-0.5 rounded text-[10px]">SUPPRESSED: ${a.suppression_reason}</span>` : `<span class="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded text-[10px] animate-pulse">ALERT PUSHED</span>`;
            
            return `
              <div class="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5 transition hover:border-slate-700">
                <div class="flex items-center justify-between text-[11px]">
                  <div class="flex items-center space-x-2">
                    <span class="px-2 py-0.5 rounded border text-[10px] font-bold ${badgeColor}">${a.impact.toUpperCase()}</span>
                    <span class="text-slate-300 font-semibold">${a.event_type}</span>
                  </div>
                  <span class="text-slate-500">${a.timestamp}</span>
                </div>
                <p class="text-slate-200 font-sans text-xs">${a.summary}</p>
                <div class="flex items-center justify-between pt-1 border-t border-slate-900 text-[10px]">
                  <a href="${a.source_url}" target="_blank" class="text-blue-400 hover:underline flex items-center">
                    <i class="fa-solid fa-link mr-1"></i> ${a.source_url.slice(0, 40)}...
                  </a>
                  <div>${statusBadge}</div>
                </div>
              </div>
            `;
          }).join("");
        }

        // Living Doc
        const docRes = await fetch(`/api/v1/delivery/workspaces/${activeWorkspace}/doc`);
        const docData = await docRes.json();
        document.getElementById("doc-render").innerHTML = marked.parse(docData.markdown || "No document yet.");
      } catch (e) {
        console.error(e);
      }
    }

    async function triggerTelemPipeline() {
      const q = document.getElementById("search-query").value;
      const btn = document.getElementById("search-btn");
      btn.disabled = true;
      btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-2"></i> Routing across Telem providers...`;
      try {
        await fetch(`/api/v1/pipeline/search-and-deliver?query=${encodeURIComponent(q)}&workspace_id=${activeWorkspace}`, {
          method: "POST"
        });
        await refreshData();
      } catch (e) {
        alert("Search failed: " + e);
      } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-magnifying-glass mr-2"></i> Execute Telem Search & Ingest`;
      }
    }

    async function simulateScenario(type) {
      let payload = {
        workspace_id: activeWorkspace,
        seq: Date.now(),
        extracted: {
          event_type: "Earnings Guidance",
          impact: "high",
          summary: "IBM raises free cash flow outlook to $13.5B citing AI middleware strength.",
          source_url: "https://newsroom.ibm.com/guidance-update-2026",
          extra_data: {}
        },
        confidence: 0.95,
        dedupe_key: "ibm-guidance-key-1",
        raw_ref: "telem://run/mock/1",
        pipeline_version: "v1"
      };

      if (type === 'partnership') {
        payload.extracted.event_type = "Partnership";
        payload.extracted.impact = "medium";
        payload.extracted.summary = "IBM and Siemens announce agent orchestration platform integration.";
        payload.extracted.source_url = "https://siemens.com/press/ibm";
        payload.dedupe_key = "siemens-partner-key-" + Date.now();
      } else if (type === 'routine') {
        payload.extracted.event_type = "Tech Blog";
        payload.extracted.impact = "low";
        payload.extracted.summary = "IBM Developer blog publishes overview on OpenShift cluster security.";
        payload.extracted.source_url = "https://ibm.com/developer/openshift";
        payload.dedupe_key = "blog-key-" + Date.now();
      } else if (type === 'duplicate') {
        payload.dedupe_key = "ibm-guidance-key-1"; // Duplicate!
      } else {
        payload.dedupe_key = "ibm-guidance-key-" + Date.now();
      }

      await fetch("/api/v1/delivery/events", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(payload)
      });
      await refreshData();
    }

    function switchTab(tab) {
      if (tab === 'feed') {
        document.getElementById("tab-feed").classList.remove("hidden");
        document.getElementById("tab-doc").classList.add("hidden");
        document.getElementById("tab-feed-btn").className = "pb-3 text-xs font-bold border-b-2 border-blue-500 text-blue-400";
        document.getElementById("tab-doc-btn").className = "pb-3 text-xs font-bold border-b-2 border-transparent text-slate-400 hover:text-slate-200";
      } else {
        document.getElementById("tab-feed").classList.add("hidden");
        document.getElementById("tab-doc").classList.remove("hidden");
        document.getElementById("tab-doc-btn").className = "pb-3 text-xs font-bold border-b-2 border-blue-500 text-blue-400";
        document.getElementById("tab-feed-btn").className = "pb-3 text-xs font-bold border-b-2 border-transparent text-slate-400 hover:text-slate-200";
      }
    }

    loadCapabilities();
    refreshData();
    setInterval(refreshData, 4000);
  </script>
</body>
</html>
"""

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "4096"))
    uvicorn.run("output_integration.server:app", host="127.0.0.1", port=port)
