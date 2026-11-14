"""
Sentinel Output Integration Delivery Service
The main orchestrator for Section D (Delivery + Integrations).
"""

import time
from typing import Optional, Dict, Any, List
try:
    from packages.contracts.models import ProcessedResult
    from .models import ChannelConfig, SuppressionPolicy, DeliveryResult
    from .store import ChangeStateStore
    from .suppression import SuppressionEngine
    from .research_doc import ResearchDocManager
    from .adapters.slack import SlackAdapter
    from .adapters.discord import DiscordAdapter
    from .adapters.generic_webhook import GenericWebhookAdapter
    from .adapters.telegram import TelegramAdapter
    from .adapters.whatsapp import WhatsAppAdapter
    from .adapters.local_feed import LocalFeedAdapter
except ImportError:
    from searchHack.packages.contracts.models import ProcessedResult
    from searchHack.output_integration.models import ChannelConfig, SuppressionPolicy, DeliveryResult
    from searchHack.output_integration.store import ChangeStateStore
    from searchHack.output_integration.suppression import SuppressionEngine
    from searchHack.output_integration.research_doc import ResearchDocManager
    from searchHack.output_integration.adapters.slack import SlackAdapter
    from searchHack.output_integration.adapters.discord import DiscordAdapter
    from searchHack.output_integration.adapters.generic_webhook import GenericWebhookAdapter
    from searchHack.output_integration.adapters.telegram import TelegramAdapter
    from searchHack.output_integration.adapters.whatsapp import WhatsAppAdapter
    from searchHack.output_integration.adapters.local_feed import LocalFeedAdapter

class DeliveryService:
    def __init__(
        self,
        storage_dir: str = "workspaces",
        channel_config: Optional[ChannelConfig] = None,
        suppression_policy: Optional[SuppressionPolicy] = None
    ):
        self.store = ChangeStateStore(storage_dir=storage_dir)
        self.suppression_engine = SuppressionEngine(self.store)
        self.doc_manager = ResearchDocManager(storage_dir=storage_dir)
        
        self.channel_config = channel_config or ChannelConfig()
        self.policy = suppression_policy or SuppressionPolicy()

        # Initialize all integration adapters
        self.slack_adapter = SlackAdapter(self.channel_config.slack_webhook_url)
        self.discord_adapter = DiscordAdapter(self.channel_config.discord_webhook_url)
        self.webhook_adapter = GenericWebhookAdapter(self.channel_config.generic_webhook_url)
        self.telegram_adapter = TelegramAdapter(
            bot_token=self.channel_config.telegram_bot_token,
            chat_id=self.channel_config.telegram_chat_id
        )
        self.whatsapp_adapter = WhatsAppAdapter(self.channel_config.whatsapp_webhook_url)
        self.local_feed = LocalFeedAdapter(storage_dir=storage_dir)

    def process_event(
        self,
        event: ProcessedResult,
        workspace_intent: Optional[str] = None
    ) -> DeliveryResult:
        """
        Main entrypoint: Consumes a validated Contract-3 event from Section C.
        1. Evaluates suppression & threshold rules (including quiet hours & deduplication).
        2. Updates living research document if novel.
        3. Delivers push alerts to active channels if meets impact/confidence threshold.
        4. Updates state store & local feed telemetry.
        """
        should_add_to_doc, should_push_alert, suppression_reason = self.suppression_engine.evaluate(
            event=event,
            policy=self.policy
        )

        delivered_channels: List[str] = []
        added_to_doc = False
        now_str = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        # 1. Update Persistent Research Document
        if should_add_to_doc:
            self.doc_manager.append_event(event, workspace_intent=workspace_intent)
            added_to_doc = True

        # 2. Push to Outbound Alert Channels
        if should_push_alert:
            if self.slack_adapter.send(event):
                delivered_channels.append("slack")
            if self.discord_adapter.send(event):
                delivered_channels.append("discord")
            if self.telegram_adapter.send(event):
                delivered_channels.append("telegram")
            if self.whatsapp_adapter.send(event):
                delivered_channels.append("whatsapp")
            if self.webhook_adapter.send(event):
                delivered_channels.append("webhook")
            
            # Local feed always records delivered alerts for Section A frontend
            delivered_channels.append("local_feed")

        # 3. Always log to local feed with reason for telemetry
        is_suppressed = not should_push_alert
        self.local_feed.record(event, suppressed=is_suppressed, reason=suppression_reason or "approved")

        # 4. Commit to Change-State Store (including last-notified value)
        self.store.mark_processed(
            workspace_id=event.workspace_id,
            seq=event.seq,
            dedupe_key=event.dedupe_key,
            extracted_data=event.extracted.model_dump() if should_push_alert else None,
            was_alert_delivered=should_push_alert,
            was_doc_added=added_to_doc,
            was_suppressed=is_suppressed
        )

        return DeliveryResult(
            workspace_id=event.workspace_id,
            seq=event.seq,
            dedupe_key=event.dedupe_key,
            delivered_to_channels=delivered_channels,
            added_to_research_doc=added_to_doc,
            suppressed=is_suppressed,
            suppression_reason=suppression_reason,
            timestamp=now_str
        )

    def get_living_doc(self, workspace_id: str) -> str:
        return self.doc_manager.read_doc(workspace_id)

    def get_alerts(self, workspace_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        return self.local_feed.get_recent(workspace_id, limit=limit)

    def get_stats(self, workspace_id: str) -> Dict[str, Any]:
        return self.store.get_stats(workspace_id)
