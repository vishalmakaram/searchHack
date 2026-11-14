"""Create a Telem monitor and give it its own webhook link.

Usage (from the project root):
    .venv/bin/python -m webhooks.create_monitor "new FAA drone rules" --frequency 1d --ttl 7d

Needs two settings in .env:
    TELEM_API_KEY=...            your Telem key
    PUBLIC_BASE_URL=https://...  the public https address that reaches webhooks/server.py
"""

import argparse
import os

from dotenv import load_dotenv
from telem import Telem

from webhooks import registry

load_dotenv()


def webhook_link(token):
    """Build the full public link Telem will POST to."""
    base = os.getenv("PUBLIC_BASE_URL", "").rstrip("/")
    if not base.startswith("https://"):
        raise RuntimeError("Set PUBLIC_BASE_URL in .env to a public https address (Telem only sends to https).")
    return f"{base}/telem/{token}"


def create_monitor_with_webhook(query, frequency="1d", ttl="7d"):
    """Create the monitor, then save its secret so the server can verify deliveries."""
    if not os.getenv("TELEM_API_KEY"):
        raise RuntimeError("TELEM_API_KEY is not set. Add it to the .env file.")

    token = registry.new_token()
    url = webhook_link(token)

    with Telem() as client:
        monitor = client.monitors.create(query, frequency=frequency, ttl=ttl, webhook_url=url)

    # Telem shows the secret ONLY in this response, so save it right away.
    if not monitor.webhook_secret:
        raise RuntimeError("Telem did not return a webhook_secret, so deliveries can't be verified.")
    registry.save_webhook(token, monitor.id, monitor.webhook_secret, query)
    return monitor, url


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Create a Telem monitor with a webhook.")
    parser.add_argument("query", help="What to watch for, as a plain sentence")
    parser.add_argument("--frequency", default="1d", help='1h, 6h, 12h, 1d or 7d (default 1d)')
    parser.add_argument("--ttl", default="7d", help="How long the monitor lives, at most 30d (default 7d)")
    args = parser.parse_args()

    monitor, url = create_monitor_with_webhook(args.query, args.frequency, args.ttl)
    print(f"Monitor created: {monitor.id} (status {monitor.status}, runs every {monitor.frequency})")
    # Show the link without its secret token.
    print(f"Webhook: {url.rsplit('/', 1)[0]}/<token>   (secret saved in data/webhooks.json)")
    if monitor.agent_note:
        print(f"Note from Telem: {monitor.agent_note}")
