"""
Sentinel Shared Contracts Spine (Contracts 1, 2, 3)
As defined in message.txt Design Doc Section 4.
Frozen contract used across:
- Section A: Control Plane / Frontend
- Section B: Ingest / Telem Connector
- Section C: Pipeline Compiler + Runtime
- Section D: Delivery + Integrations
"""

from typing import Dict, Any, List, Optional, Literal
from pydantic import BaseModel, Field
import hashlib
import time

# -------------------------------------------------------------
# CONTRACT 1: Workspace Spec (A -> B, C)
# -------------------------------------------------------------
class ExtractionSchema(BaseModel):
    event_type: str = "string"
    impact: str = "low|medium|high"
    summary: str = "string"
    source_url: str = "string"
    published_at: Optional[str] = None
    extra_fields: Optional[Dict[str, Any]] = None

class WorkspaceSpec(BaseModel):
    workspace_id: str
    intent: str
    queries: List[str]
    frequency: Literal["1h", "6h", "12h", "1d", "7d"] = "1h"
    escalation_providers: List[str] = Field(default_factory=lambda: ["brave", "exa", "tavily"])
    extraction_schema: Dict[str, Any] = Field(
        default_factory=lambda: {
            "event_type": "string",
            "impact": "low|medium|high",
            "summary": "string",
            "source_url": "string",
            "published_at": "string|null"
        }
    )

# -------------------------------------------------------------
# CONTRACT 2: New-Change Event (B -> C)
# -------------------------------------------------------------
class NewChangeEvent(BaseModel):
    workspace_id: str
    seq: int
    kind: Literal["entity_added", "value_changed", "alert", "run", "plan_changed"]
    url: str
    page_text: str
    telem_run_id: str
    received_at: str

# -------------------------------------------------------------
# CONTRACT 3: Processed Result (C -> D)
# The contract that Output Integration consumes!
# -------------------------------------------------------------
class ExtractedPayload(BaseModel):
    event_type: str
    impact: Literal["low", "medium", "high"] = "medium"
    summary: str
    source_url: str
    published_at: Optional[str] = None
    extra_data: Optional[Dict[str, Any]] = None

class ProcessedResult(BaseModel):
    workspace_id: str
    seq: int
    extracted: ExtractedPayload
    confidence: float = Field(ge=0.0, le=1.0)
    dedupe_key: str
    raw_ref: str
    pipeline_version: str = "v1"

    @classmethod
    def create_mock(
        cls,
        workspace_id: str,
        seq: int,
        event_type: str,
        summary: str,
        impact: Literal["low", "medium", "high"],
        source_url: str,
        confidence: float = 0.92,
        published_at: Optional[str] = None
    ) -> "ProcessedResult":
        # Deterministic dedupe key based on content
        content_str = f"{workspace_id}:{event_type}:{summary.strip().lower()}"
        dedupe_hash = hashlib.sha256(content_str.encode("utf-8")).hexdigest()
        
        return cls(
            workspace_id=workspace_id,
            seq=seq,
            extracted=ExtractedPayload(
                event_type=event_type,
                impact=impact,
                summary=summary,
                source_url=source_url,
                published_at=published_at or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            ),
            confidence=confidence,
            dedupe_key=dedupe_hash,
            raw_ref=f"telem://runs/{workspace_id}/{seq}",
            pipeline_version="v1"
        )
