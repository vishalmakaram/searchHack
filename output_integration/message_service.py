"""Send simple agent messages to configured outbound integrations."""

from typing import Literal, Optional

import requests
from pydantic import BaseModel

from .models import ChannelConfig


Channel = Literal["telegram", "whatsapp", "slack", "discord", "webhook"]


class MessageRequest(BaseModel):
    send_msg: Optional[str] = None
    sned_msg: Optional[str] = None  # Accept the spelling used by some agent callers.
    channel: Optional[Channel] = None  # Omit to send to every configured channel.


class MessageDeliveryService:
    def __init__(self, config: ChannelConfig):
        self.config = config

    def configured(self, channel: Channel) -> bool:
        config = self.config
        return {
            "telegram": bool(config.telegram_bot_token and config.telegram_chat_id),
            "whatsapp": bool(config.whatsapp_webhook_url),
            "slack": bool(config.slack_webhook_url),
            "discord": bool(config.discord_webhook_url),
            "webhook": bool(config.generic_webhook_url),
        }[channel]

    def send(self, message: str, channel: Channel) -> bool:
        config = self.config
        if channel == "telegram":
            url = f"https://api.telegram.org/bot{config.telegram_bot_token}/sendMessage"
            payload = {"chat_id": config.telegram_chat_id, "text": message}
        elif channel == "whatsapp":
            # This requires a WhatsApp gateway webhook that accepts {"message": ...}.
            url = config.whatsapp_webhook_url
            payload = {"message": message}
        elif channel == "slack":
            url = config.slack_webhook_url
            payload = {"text": message}
        elif channel == "discord":
            url = config.discord_webhook_url
            payload = {"content": message}
        else:
            url = config.generic_webhook_url
            payload = {"send_msg": message}

        try:
            response = requests.post(url, json=payload, timeout=5)
            return 200 <= response.status_code < 300
        except requests.RequestException:
            return False
