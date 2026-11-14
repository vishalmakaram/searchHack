"""
Output Integration Domain Models
Defines settings, delivery status, suppression policies, and quiet-hours configuration.
"""

from typing import List, Optional, Literal, Dict, Any
from pydantic import BaseModel, Field

class ChannelConfig(BaseModel):
    slack_webhook_url: Optional[str] = None
    discord_webhook_url: Optional[str] = None
    generic_webhook_url: Optional[str] = None
    telegram_bot_token: Optional[str] = None
    telegram_chat_id: Optional[str] = None
    whatsapp_webhook_url: Optional[str] = None

class SuppressionPolicy(BaseModel):
    # Minimum confidence to process (otherwise reject/suppress)
    min_confidence: float = Field(default=0.65, ge=0.0, le=1.0)
    
    # Which impacts trigger external push alerts (Slack/Discord/Telegram/WhatsApp)
    # Low-impact items still get added to the research doc, but won't spam phones/channels!
    push_alert_impacts: List[str] = Field(default_factory=lambda: ["high", "medium"])
    
    # Cooldown in seconds before alerting on the exact same dedupe_key again (default 24h)
    dedupe_cooldown_seconds: int = 86400
    
    # Rate limit: Max push alerts per workspace per hour (prevents notification storms)
    max_alerts_per_hour: int = 6

    # Quiet Hours Configuration (message.txt requirement)
    quiet_hours_enabled: bool = False
    quiet_hours_start: int = 22  # 10 PM (24h format)
    quiet_hours_end: int = 7     # 7 AM (24h format)
    quiet_hours_allow_high_impact: bool = True  # High-impact breaking news can break through quiet hours

class DeliveryResult(BaseModel):
    workspace_id: str
    seq: int
    dedupe_key: str
    delivered_to_channels: List[str] = Field(default_factory=list)
    added_to_research_doc: bool = False
    suppressed: bool = False
    suppression_reason: Optional[str] = None
    timestamp: str
