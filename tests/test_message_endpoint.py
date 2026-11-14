import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException

from output_integration import server
from output_integration.message_service import MessageDeliveryService, MessageRequest
from output_integration.models import ChannelConfig


class MessageEndpointTests(unittest.TestCase):
    def setUp(self):
        self.original_service = server.message_service
        server.message_service = MessageDeliveryService(ChannelConfig(
            telegram_bot_token="test-token",
            telegram_chat_id="123",
            slack_webhook_url="https://example.com/slack",
        ))

    def tearDown(self):
        server.message_service = self.original_service

    @patch("output_integration.message_service.requests.post")
    def test_simple_message_goes_to_requested_telegram_chat(self, post):
        post.return_value = Mock(status_code=200)
        response = server.send_agent_message(MessageRequest(
            send_msg="abc", channel="telegram"
        ))
        self.assertEqual(response, {"delivery": {"telegram": "sent"}})
        post.assert_called_once_with(
            "https://api.telegram.org/bottest-token/sendMessage",
            json={"chat_id": "123", "text": "abc"},
            timeout=5,
        )

    @patch("output_integration.message_service.requests.post")
    def test_typo_alias_sends_to_all_configured_channels(self, post):
        post.return_value = Mock(status_code=200)
        response = server.send_agent_message(MessageRequest(sned_msg="abc"))
        self.assertEqual(response, {
            "delivery": {"telegram": "sent", "slack": "sent"}
        })
        self.assertEqual(post.call_count, 2)

    def test_unconfigured_channel_returns_error(self):
        with self.assertRaises(HTTPException) as error:
            server.send_agent_message(MessageRequest(send_msg="abc", channel="whatsapp"))
        self.assertEqual(error.exception.status_code, 503)

    def test_empty_message_is_rejected(self):
        with self.assertRaises(HTTPException) as error:
            server.send_agent_message(MessageRequest(send_msg="  "))
        self.assertEqual(error.exception.status_code, 422)

    @patch("output_integration.message_service.requests.post")
    def test_failed_delivery_is_reported(self, post):
        post.return_value = Mock(status_code=500)
        with self.assertRaises(HTTPException) as error:
            server.send_agent_message(MessageRequest(send_msg="abc", channel="telegram"))
        self.assertEqual(error.exception.status_code, 502)
        self.assertEqual(error.exception.detail, {
            "delivery": {"telegram": "failed"}
        })


if __name__ == "__main__":
    unittest.main()
