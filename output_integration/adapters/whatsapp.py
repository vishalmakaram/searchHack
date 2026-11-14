"""
WhatsApp Delivery Adapter
Delivers structured WhatsApp alert messages via webhook endpoint or Twilio gateway.
"""

import requests
from typing import Optional
try:
    from packages.contracts.models import ProcessedResult
except ImportError:
    from searchHack.packages.contracts.models import ProcessedResult

class WhatsAppAdapter:
    def __init__(self, webhook_url: Optional[str] = None):
        self.webhook_url = webhook_url

    def send(self, event: ProcessedResult) -> bool:
        if not self.webhook_url:
            return False

        ext = event.extracted
        # WhatsApp supports *bold*, _italic_, and clean emoji
        message = (
            f"🔔 *SENTINEL ALERT: {ext.event_type.upper()}*\n"
            f"Impact: *{ext.impact.upper()}* | Workspace: `{event.workspace_id}`\n\n"
            f"{ext.summary}\n\n"
            f"📄 Source: {ext.source_url}\n"
            f"_Confidence: {event.confidence * 100:.1f}%_"
        )

        payload = {
            "to": "sentinel-alerts-group",
            "message": message,
            "raw_event": event.model_dump()
        }

        try:
            resp = requests.post(self.webhook_url, json=payload, timeout=5)
            return resp.status_code in (200, 201, 202, 204)
        except Exception:
            return False
