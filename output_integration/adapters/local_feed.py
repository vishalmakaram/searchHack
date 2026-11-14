"""
Local Feed Adapter
Logs delivered alerts to local JSON Lines file and memory buffer for the Section A Local Frontend.
"""

import json
import time
from pathlib import Path
from typing import List, Dict, Any
try:
    from packages.contracts.models import ProcessedResult
except ImportError:
    from searchHack.packages.contracts.models import ProcessedResult

class LocalFeedAdapter:
    def __init__(self, storage_dir: str = "workspaces"):
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self._memory_feed: List[Dict[str, Any]] = []

    def _get_feed_path(self, workspace_id: str) -> Path:
        ws_dir = self.storage_dir / workspace_id
        ws_dir.mkdir(parents=True, exist_ok=True)
        return ws_dir / "alerts.jsonl"

    def record(self, event: ProcessedResult, suppressed: bool = False, reason: str = ""):
        feed_path = self._get_feed_path(event.workspace_id)
        entry = {
            "workspace_id": event.workspace_id,
            "seq": event.seq,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%SZ", time.gmtime()),
            "suppressed": suppressed,
            "suppression_reason": reason,
            "event_type": event.extracted.event_type,
            "impact": event.extracted.impact,
            "summary": event.extracted.summary,
            "source_url": event.extracted.source_url,
            "confidence": event.confidence,
            "dedupe_key": event.dedupe_key
        }

        self._memory_feed.append(entry)
        if len(self._memory_feed) > 500:
            self._memory_feed = self._memory_feed[-500:]

        with open(feed_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")

    def get_recent(self, workspace_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        feed_path = self._get_feed_path(workspace_id)
        if not feed_path.exists():
            return []

        entries = []
        with open(feed_path, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    try:
                        entries.append(json.loads(line.strip()))
                    except Exception:
                        pass
        return entries[-limit:]
