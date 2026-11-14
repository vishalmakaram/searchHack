"""
Comprehensive Test Suite for Sentinel Section D (Output Integration)
Verifies:
1. Low confidence filtering
2. Duplicate event deduplication & cooldown
3. Monotonic sequence deduplication
4. Impact-based push filtering
5. Quiet-hours suppression
6. Rate-limiting (anti-storm)
7. Research doc formatting and accumulation
8. State persistence & last-notified values
"""

import os
import tempfile
import unittest
from unittest.mock import patch, MagicMock

from packages.contracts.models import ProcessedResult
from output_integration.service import DeliveryService
from output_integration.models import ChannelConfig, SuppressionPolicy

class TestOutputIntegrationComprehensive(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.storage_dir = self.temp_dir.name

    def tearDown(self):
        self.temp_dir.cleanup()

    def create_event(self, seq=1, summary="IBM updates earnings guidance", impact="high", confidence=0.92, dedupe_key=None):
        evt = ProcessedResult.create_mock(
            workspace_id="test_ws",
            seq=seq,
            event_type="Earnings Update",
            summary=summary,
            impact=impact,
            source_url="https://ibm.com/news",
            confidence=confidence
        )
        if dedupe_key:
            evt.dedupe_key = dedupe_key
        return evt

    def test_confidence_rejection(self):
        service = DeliveryService(storage_dir=self.storage_dir)
        low_conf = self.create_event(seq=1, confidence=0.45)
        res = service.process_event(low_conf)

        self.assertTrue(res.suppressed)
        self.assertFalse(res.added_to_research_doc)
        self.assertIn("Confidence", res.suppression_reason)

    def test_duplicate_key_cooldown(self):
        service = DeliveryService(storage_dir=self.storage_dir)
        evt1 = self.create_event(seq=1, summary="Guidance Raised to $12B")
        evt2 = self.create_event(seq=2, summary="Guidance Raised to $12B") # Identical content -> same dedupe_key

        res1 = service.process_event(evt1)
        res2 = service.process_event(evt2)

        self.assertFalse(res1.suppressed)
        self.assertTrue(res1.added_to_research_doc)

        self.assertTrue(res2.suppressed)
        self.assertFalse(res2.added_to_research_doc)
        self.assertIn("Duplicate event key", res2.suppression_reason)

    def test_monotonic_seq_deduplication(self):
        service = DeliveryService(storage_dir=self.storage_dir)
        evt1 = self.create_event(seq=5, summary="Summary A")
        evt2 = self.create_event(seq=5, summary="Summary B") # Same sequence number!

        res1 = service.process_event(evt1)
        res2 = service.process_event(evt2)

        self.assertFalse(res1.suppressed)
        self.assertTrue(res2.suppressed)
        self.assertIn("Duplicate sequence ID", res2.suppression_reason)

    def test_impact_routing_low_impact_logs_to_doc_without_alert(self):
        service = DeliveryService(storage_dir=self.storage_dir)
        low_impact_evt = self.create_event(seq=10, summary="Routine marketing blog", impact="low")
        res = service.process_event(low_impact_evt)

        # Crucial requirement: Should be in research doc, but NOT sent as push alert!
        self.assertTrue(res.added_to_research_doc)
        self.assertTrue(res.suppressed)
        self.assertIn("does not meet push threshold", res.suppression_reason)

    def test_rate_limiting_anti_storm(self):
        policy = SuppressionPolicy(max_alerts_per_hour=3)
        service = DeliveryService(storage_dir=self.storage_dir, suppression_policy=policy)

        # Send 5 distinct high-impact events
        results = [
            service.process_event(self.create_event(seq=i, summary=f"Critical breaking update #{i}", impact="high"))
            for i in range(1, 6)
        ]

        # First 3 delivered
        self.assertFalse(results[0].suppressed)
        self.assertFalse(results[1].suppressed)
        self.assertFalse(results[2].suppressed)

        # 4th and 5th suppressed by rate limit
        self.assertTrue(results[3].suppressed)
        self.assertIn("Rate limit reached", results[3].suppression_reason)
        self.assertTrue(results[4].suppressed)
        self.assertIn("Rate limit reached", results[4].suppression_reason)

    def test_quiet_hours_suppresses_medium_but_allows_high_impact(self):
        policy = SuppressionPolicy(
            quiet_hours_enabled=True,
            quiet_hours_start=0,
            quiet_hours_end=24, # Always in quiet hours for test
            quiet_hours_allow_high_impact=True
        )
        service = DeliveryService(storage_dir=self.storage_dir, suppression_policy=policy)

        med_evt = self.create_event(seq=1, summary="Minor analyst adjustment", impact="medium")
        high_evt = self.create_event(seq=2, summary="CEO Resignation", impact="high")

        res_med = service.process_event(med_evt)
        res_high = service.process_event(high_evt)

        self.assertTrue(res_med.suppressed)
        self.assertIn("Quiet Hours", res_med.suppression_reason)
        self.assertTrue(res_med.added_to_research_doc)

        # High impact breaks through quiet hours!
        self.assertFalse(res_high.suppressed)
        self.assertTrue(res_high.added_to_research_doc)

    def test_state_persistence_and_last_notified_value(self):
        service1 = DeliveryService(storage_dir=self.storage_dir)
        evt = self.create_event(seq=1, summary="Initial guidance $10B", impact="high")
        service1.process_event(evt)

        # Check last notified value is recorded
        last_val = service1.store.get_last_notified_value("test_ws", evt.dedupe_key)
        self.assertIsNotNone(last_val)
        self.assertEqual(last_val["summary"], "Initial guidance $10B")

        # Re-instantiate service (simulating crash / server restart)
        service2 = DeliveryService(storage_dir=self.storage_dir)
        self.assertTrue(service2.store.is_seq_processed("test_ws", 1))
        self.assertTrue(service2.store.is_key_duplicate("test_ws", evt.dedupe_key, 86400))

    def test_research_document_accumulation(self):
        service = DeliveryService(storage_dir=self.storage_dir)
        evt1 = self.create_event(seq=1, summary="Event Alpha with | pipe character", impact="high")
        evt2 = self.create_event(seq=2, summary="Event Beta with newline\ninside", impact="medium")

        service.process_event(evt1)
        service.process_event(evt2)

        doc = service.get_living_doc("test_ws")
        self.assertIn("# Sentinel Living Research Document", doc)
        self.assertIn("Event Alpha", doc)
        self.assertIn("Event Beta", doc)
        # Verify markdown pipe was escaped so table doesn't break
        self.assertIn("Event Alpha with \\| pipe character", doc)

    @patch("requests.post")
    def test_telegram_and_slack_adapters(self, mock_post):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_post.return_value = mock_response

        channels = ChannelConfig(
            slack_webhook_url="https://hooks.slack.com/services/test",
            telegram_bot_token="123456:ABC-DEF",
            telegram_chat_id="-100123456"
        )
        service = DeliveryService(storage_dir=self.storage_dir, channel_config=channels)
        evt = self.create_event(seq=1, impact="high")

        res = service.process_event(evt)
        self.assertIn("slack", res.delivered_to_channels)
        self.assertIn("telegram", res.delivered_to_channels)
        self.assertEqual(mock_post.call_count, 2)

if __name__ == "__main__":
    unittest.main()
