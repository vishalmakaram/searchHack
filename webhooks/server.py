"""A tiny web server that receives Telem monitor webhooks.

Telem sends a POST to  /telem/<token>  whenever a monitor finds new results.
For each delivery we:
  1. look up the monitor's secret by <token>
  2. check the Telem-Signature header with telem.verify_webhook
  3. save the JSON body to data/deliveries/<monitor_id>/<time>.json

Run it from the project root:
    .venv/bin/python -m webhooks.server
It listens on http://localhost:8787. Telem needs a PUBLIC https address that
points here (a tunnel such as cloudflared or ngrok, or a hosted server).
"""

import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from telem import verify_webhook

from webhooks import registry

PORT = int(os.getenv("WEBHOOK_PORT", "8787"))
DELIVERIES_DIR = registry.DATA_DIR / "deliveries"


class TelemWebhookHandler(BaseHTTPRequestHandler):
    def _reply(self, status, message):
        body = json.dumps({"message": message}).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        # A simple "are you alive?" check, handy for testing the public link.
        if self.path == "/health":
            self._reply(200, "ok")
        else:
            self._reply(404, "not found")

    def do_POST(self):
        # The path must look like /telem/<token>
        parts = self.path.strip("/").split("/")
        if len(parts) != 2 or parts[0] != "telem":
            self._reply(404, "not found")
            return

        webhook = registry.find(parts[1])
        if webhook is None:
            self._reply(404, "unknown webhook")
            return

        # Read the body exactly as sent: the signature is computed over these bytes.
        length = int(self.headers.get("Content-Length", 0))
        raw_body = self.rfile.read(length)

        signature = self.headers.get("Telem-Signature", "")
        if not verify_webhook(raw_body, signature, webhook["secret"]):
            self._reply(401, "bad signature")
            return

        # Save the delivery so the rest of the app can use it.
        folder = DELIVERIES_DIR / webhook["monitor_id"]
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"{time.strftime('%Y%m%d-%H%M%S')}-{time.time_ns() % 10**6}.json"
        path.write_bytes(raw_body)

        print(f"Delivery for monitor {webhook['monitor_id']} saved to {path.name}")
        self._reply(200, "received")

    def log_message(self, format, *args):
        # Print short request logs, without the secret token from the path.
        path = self.path.split("/telem/")[0] + ("/telem/<token>" if "/telem/" in self.path else "")
        print(f"{self.command} {path} -> {args[1] if len(args) > 1 else ''}")


def main():
    server = ThreadingHTTPServer(("0.0.0.0", PORT), TelemWebhookHandler)
    print(f"Listening for Telem webhooks on http://localhost:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
