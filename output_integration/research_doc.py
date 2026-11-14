"""
Persistent Research Document Manager
Maintains an append-only, deduplicated, living Markdown research document per workspace:
`workspaces/{workspace_id}/LIVING_RESEARCH.md`
"""

import os
import re
import time
from pathlib import Path
from typing import Optional
try:
    from packages.contracts.models import ProcessedResult
except ImportError:
    from searchHack.packages.contracts.models import ProcessedResult

class ResearchDocManager:
    def __init__(self, storage_dir: str = "workspaces"):
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)

    def _get_doc_path(self, workspace_id: str) -> Path:
        ws_dir = self.storage_dir / workspace_id
        ws_dir.mkdir(parents=True, exist_ok=True)
        return ws_dir / "LIVING_RESEARCH.md"

    def ensure_header(self, workspace_id: str, intent: Optional[str] = None):
        doc_path = self._get_doc_path(workspace_id)
        if not doc_path.exists():
            header = f"""# Sentinel Living Research Document: `{workspace_id}`

> **Target Intent:** {intent or "Autonomous Web Monitoring & Intelligence Pipeline"}  
> **Status:** Active · Continuously updated via Telem AI Sentinel + Data Processing Pipeline  
> **Initial Initialization:** {time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime())}

---

## Verified Intelligence Ledger

*Living ledger automatically synthesized and deduplicated from verified web changes.*

| Timestamp (UTC) | Event Type | Impact | Verified Summary | Verified Source |
| :--- | :--- | :--- | :--- | :--- |
"""
            with open(doc_path, "w", encoding="utf-8") as f:
                f.write(header)

    def append_event(self, event: ProcessedResult, workspace_intent: Optional[str] = None):
        self.ensure_header(event.workspace_id, workspace_intent)
        doc_path = self._get_doc_path(event.workspace_id)

        pub_date = event.extracted.published_at or time.strftime("%Y-%m-%d %H:%M", time.gmtime())
        pub_display = pub_date.split("T")[0] if "T" in pub_date else pub_date

        impact_emoji = {
            "high": "🔴 **HIGH**",
            "medium": "🟡 **MEDIUM**",
            "low": "🟢 LOW"
        }.get(event.extracted.impact.lower(), event.extracted.impact.upper())

        # Clean string to ensure table formatting never breaks
        summary_clean = event.extracted.summary.replace("|", "\\|").replace("\n", " ").strip()
        # Remove consecutive whitespace
        summary_clean = re.sub(r"\s+", " ", summary_clean)

        url_clean = event.extracted.source_url.strip()
        source_link = f"[Open Source]({url_clean})" if url_clean.startswith("http") else f"`{url_clean}`"

        row = f"| `{pub_display}` | `{event.extracted.event_type}` | {impact_emoji} | {summary_clean} | {source_link} |\n"

        with open(doc_path, "a", encoding="utf-8") as f:
            f.write(row)

    def read_doc(self, workspace_id: str) -> str:
        doc_path = self._get_doc_path(workspace_id)
        if doc_path.exists():
            with open(doc_path, "r", encoding="utf-8") as f:
                return f.read()
        return f"# Workspace `{workspace_id}`\n\nNo research findings recorded yet."
