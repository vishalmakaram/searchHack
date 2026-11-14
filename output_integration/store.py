"""
Change-State Store
Persistent state tracking for:
- Monotonic `seq` deduplication
- `dedupe_key` cache with cooldowns
- Last-notified value per dedupe_key (message.txt requirement)
- Rolling alert counts for rate-limiting
"""

import json
import os
import time
from typing import Dict, Any, Optional, Set, List
from pathlib import Path

class ChangeStateStore:
    def __init__(self, storage_dir: str = "workspaces"):
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        # In-memory fast cache: workspace_id -> state dict
        self._cache: Dict[str, Dict[str, Any]] = {}

    def _get_workspace_path(self, workspace_id: str) -> Path:
        ws_dir = self.storage_dir / workspace_id
        ws_dir.mkdir(parents=True, exist_ok=True)
        return ws_dir / "change_state.json"

    def _load_state(self, workspace_id: str) -> Dict[str, Any]:
        if workspace_id in self._cache:
            return self._cache[workspace_id]

        file_path = self._get_workspace_path(workspace_id)
        if file_path.exists():
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    state = json.load(f)
                    self._cache[workspace_id] = state
                    return state
            except Exception:
                pass

        initial_state = {
            "workspace_id": workspace_id,
            "processed_seqs": [],      # list of ints
            "seen_keys": {},           # dedupe_key -> timestamp
            "last_notified_values": {},# dedupe_key -> {"summary": str, "value": dict, "timestamp": float}
            "alert_history": [],       # list of timestamps of delivered alerts
            "stats": {
                "total_received": 0,
                "total_alerts_delivered": 0,
                "total_suppressed": 0,
                "doc_entries": 0
            }
        }
        self._cache[workspace_id] = initial_state
        return initial_state

    def _save_state(self, workspace_id: str):
        state = self._cache.get(workspace_id)
        if not state:
            return
        file_path = self._get_workspace_path(workspace_id)
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)

    def is_seq_processed(self, workspace_id: str, seq: int) -> bool:
        state = self._load_state(workspace_id)
        return seq in state["processed_seqs"]

    def is_key_duplicate(self, workspace_id: str, dedupe_key: str, cooldown_seconds: int) -> bool:
        state = self._load_state(workspace_id)
        seen_keys = state["seen_keys"]
        now = time.time()
        
        if dedupe_key in seen_keys:
            last_seen = seen_keys[dedupe_key]
            if (now - last_seen) < cooldown_seconds:
                return True
        return False

    def get_last_notified_value(self, workspace_id: str, dedupe_key: str) -> Optional[Dict[str, Any]]:
        state = self._load_state(workspace_id)
        return state.get("last_notified_values", {}).get(dedupe_key)

    def mark_processed(
        self,
        workspace_id: str,
        seq: int,
        dedupe_key: str,
        extracted_data: Optional[Dict[str, Any]],
        was_alert_delivered: bool,
        was_doc_added: bool,
        was_suppressed: bool
    ):
        state = self._load_state(workspace_id)
        now = time.time()

        if seq not in state["processed_seqs"]:
            state["processed_seqs"].append(seq)
            if len(state["processed_seqs"]) > 1000:
                state["processed_seqs"] = state["processed_seqs"][-1000:]

        # Only record dedupe_key if the event was accepted (added to doc or alert delivered).
        # A rejected low-confidence event should NOT poison the dedupe cache for a later verified event!
        if was_doc_added or was_alert_delivered:
            state["seen_keys"][dedupe_key] = now
        state["stats"]["total_received"] += 1

        if extracted_data and was_alert_delivered:
            state.setdefault("last_notified_values", {})[dedupe_key] = {
                "summary": extracted_data.get("summary", ""),
                "data": extracted_data,
                "timestamp": now
            }

        if was_alert_delivered:
            state["alert_history"].append(now)
            state["stats"]["total_alerts_delivered"] += 1

        if was_doc_added:
            state["stats"]["doc_entries"] += 1

        if was_suppressed:
            state["stats"]["total_suppressed"] += 1

        self._save_state(workspace_id)

    def get_recent_alert_count(self, workspace_id: str, window_seconds: int = 3600) -> int:
        state = self._load_state(workspace_id)
        now = time.time()
        recent = [t for t in state["alert_history"] if (now - t) <= window_seconds]
        state["alert_history"] = recent
        return len(recent)

    def get_stats(self, workspace_id: str) -> Dict[str, Any]:
        state = self._load_state(workspace_id)
        return state["stats"]
