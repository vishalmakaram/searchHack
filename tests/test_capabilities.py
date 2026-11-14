import json
import unittest

from output_integration import server
from output_integration.message_service import MessageDeliveryService
from output_integration.models import ChannelConfig


class CapabilitiesTests(unittest.TestCase):
    def setUp(self):
        self.previous = server.message_service
        server.message_service = MessageDeliveryService(ChannelConfig(
            telegram_bot_token="secret-test-token",
            telegram_chat_id="12345",
            slack_webhook_url="https://example.com/secret-hook",
        ))

    def tearDown(self):
        server.message_service = self.previous

    def test_reports_operations_and_channel_readiness_without_secrets(self):
        result = server.get_capabilities(server.CapabilitiesRequest())
        outputs = {item["name"]: item for item in result["outputs"]}
        self.assertTrue(outputs["telegram"]["configured"])
        self.assertTrue(outputs["slack"]["configured"])
        self.assertFalse(outputs["whatsapp"]["configured"])
        self.assertTrue(outputs["research_document"]["configured"])
        self.assertIn("deduplication", result["operations"])
        self.assertIn("/api/v1/delivery/events", [item["path"] for item in result["inputs"]])
        serialized = json.dumps(result)
        self.assertNotIn("secret-test-token", serialized)
        self.assertNotIn("secret-hook", serialized)

    def test_optional_input_schemas(self):
        result = server.get_capabilities(server.CapabilitiesRequest(include_schemas=True))
        self.assertIn("ProcessedResult", result["schemas"])
        self.assertIn("MessageRequest", result["schemas"])

    def test_empty_post_body_is_allowed(self):
        result = server.get_capabilities()
        self.assertEqual(result["service"], "sentinel-output-integration")
        self.assertNotIn("schemas", result)


if __name__ == "__main__":
    unittest.main()
