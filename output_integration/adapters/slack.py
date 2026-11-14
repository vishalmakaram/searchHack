"""
Slack BlockKit Delivery Adapter
Formats Contract-3 events into high-fidelity Slack messages.
"""

import requests
import json
from typing import Optional
try:
    from packages.contracts.models import ProcessedResult
except ImportError:
    from searchHack.packages.contracts.models import ProcessedResult

class SlackAdapter:
    def __init__(self, webhook_url: Optional[str] = None):
        self.webhook_url = webhook_url

    def send(self, event: ProcessedResult) -> bool:
        if not self.webhook_url:
            return False

        ext = event.extracted
        impact_indicator = {
            "high": "🚨 *HIGH IMPACT*",
            "medium": "⚠️ *MEDIUM IMPACT*",
            "low": "ℹ️ *LOW IMPACT*"
        }.get(ext.impact.lower(), "*UPDATE*")

        payload = {
            "text": f"Sentinel Alert: {ext.event_type} - {ext.summary[:80]}",
            "blocks": [
                {
                    "type": "header",
                    "text": {
                        "type": "plain_text",
                        "text": f"Sentinel Intelligence: {ext.event_type.upper()}",
                        "emoji": True
                    }
                },
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"{impact_indicator} · *Workspace:* `{event.workspace_id}`\n\n{ext.summary}"
                    }
                },
                {
                    "type": "context",
                    "elements": [
                        {
                            "type": "mrkdwn",
                            "text": f"🔗 <{ext.source_url}|View Source Document> | Confidence: `{event.confidence * 100:.1f}%`"
                        }
                    ]
                },
                {"type": "divider"}
            ]
        }

        try:
            resp = requests.post(self.webhook_url, json=payload, timeout=5)
            return resp.status_code == 200
        except Exception:
            return False
