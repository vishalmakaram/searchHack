"""
Discord Webhook Delivery Adapter
Formats Contract-3 events into rich Discord embeds with color-coded impact tiers.
"""

import requests
from typing import Optional
try:
    from packages.contracts.models import ProcessedResult
except ImportError:
    from searchHack.packages.contracts.models import ProcessedResult

class DiscordAdapter:
    def __init__(self, webhook_url: Optional[str] = None):
        self.webhook_url = webhook_url

    def send(self, event: ProcessedResult) -> bool:
        if not self.webhook_url:
            return False

        ext = event.extracted
        # Color codes: Red for High, Amber for Medium, Blue for Low
        colors = {
            "high": 0xFF0033,    # Red
            "medium": 0xFF9900,  # Amber
            "low": 0x3399FF      # Blue
        }
        color = colors.get(ext.impact.lower(), 0x999999)

        payload = {
            "username": "Sentinel Intelligence",
            "embeds": [
                {
                    "title": f"[{ext.impact.upper()}] {ext.event_type.replace('_', ' ').title()}",
                    "description": ext.summary,
                    "url": ext.source_url,
                    "color": color,
                    "fields": [
                        {
                            "name": "Workspace",
                            "value": f"`{event.workspace_id}`",
                            "inline": True
                        },
                        {
                            "name": "Confidence",
                            "value": f"`{event.confidence * 100:.1f}%`",
                            "inline": True
                        },
                        {
                            "name": "Source",
                            "value": f"[Open Verified Page]({ext.source_url})",
                            "inline": False
                        }
                    ],
                    "footer": {
                        "text": f"Sentinel Pipeline {event.pipeline_version} · Seq #{event.seq}"
                    }
                }
            ]
        }

        try:
            resp = requests.post(self.webhook_url, json=payload, timeout=5)
            return resp.status_code in (200, 204)
        except Exception:
            return False
