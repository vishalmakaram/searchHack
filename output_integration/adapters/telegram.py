"""
Telegram Delivery Adapter
Delivers formatted alerts to a Telegram chat or channel via Bot API.
"""

import requests
from typing import Optional
try:
    from packages.contracts.models import ProcessedResult
except ImportError:
    from searchHack.packages.contracts.models import ProcessedResult

class TelegramAdapter:
    def __init__(self, bot_token: Optional[str] = None, chat_id: Optional[str] = None):
        self.bot_token = bot_token
        self.chat_id = chat_id

    def send(self, event: ProcessedResult) -> bool:
        if not self.bot_token or not self.chat_id:
            return False

        ext = event.extracted
        impact_badge = {
            "high": "🚨 <b>HIGH IMPACT</b>",
            "medium": "⚠️ <b>MEDIUM IMPACT</b>",
            "low": "ℹ️ <b>LOW IMPACT</b>"
        }.get(ext.impact.lower(), "<b>UPDATE</b>")

        # Telegram HTML formatting
        text = (
            f"<b>Sentinel Intelligence Alert</b>\n"
            f"Workspace: <code>{event.workspace_id}</code>\n"
            f"Type: <b>{ext.event_type.title()}</b> | {impact_badge}\n\n"
            f"{ext.summary}\n\n"
            f"🔗 <a href=\"{ext.source_url}\">View Verified Source Document</a>\n"
            f"<i>Confidence: {event.confidence * 100:.1f}% · Seq #{event.seq}</i>"
        )

        url = f"https://api.telegram.org/bot{self.bot_token}/sendMessage"
        payload = {
            "chat_id": self.chat_id,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": False
        }

        try:
            resp = requests.post(url, json=payload, timeout=5)
            return resp.status_code == 200
        except Exception:
            return False
