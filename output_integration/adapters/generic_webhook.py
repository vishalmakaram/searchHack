"""
Generic HTTP Webhook Out Adapter
Delivers structured Contract-3 JSON payloads to any external webhook URL.
"""

import requests
from typing import Optional
try:
    from packages.contracts.models import ProcessedResult
except ImportError:
    from searchHack.packages.contracts.models import ProcessedResult

class GenericWebhookAdapter:
    def __init__(self, webhook_url: Optional[str] = None):
        self.webhook_url = webhook_url

    def send(self, event: ProcessedResult) -> bool:
        if not self.webhook_url:
            return False

        payload = event.model_dump()
        try:
            resp = requests.post(self.webhook_url, json=payload, timeout=5)
            return resp.status_code in (200, 201, 202, 204)
        except Exception:
            return False
