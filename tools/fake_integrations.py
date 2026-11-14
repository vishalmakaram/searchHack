"""Stand-in for the teammate's integration proxy on :4096.

Same contract they are building against: GET /capabilities lists integrations,
POST <path> calls one. Swap for theirs by killing this process.
"""
from __future__ import annotations

import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("INTEGRATIONS_PORT", "4096"))
LOG = os.environ.get("INTEGRATIONS_LOG", "/tmp/integrations.log")

CAPABILITIES = {
    "service": "integrations-proxy-stub",
    "integrations": [
        {
            "name": "notify",
            "method": "POST",
            "path": "/notify",
            "description": "Send a short notification to the team channel.",
            "body_schema": {"title": "string", "body": "string", "url": "string"},
        },
        {
            "name": "sheet_append",
            "method": "POST",
            "path": "/sheet/append",
            "description": "Append one row to the shared tracking sheet.",
            "body_schema": {"row": "object"},
        },
        {
            "name": "task_create",
            "method": "POST",
            "path": "/tasks",
            "description": "Create a follow-up task for a human.",
            "body_schema": {"title": "string", "due": "string (YYYY-MM-DD)", "notes": "string"},
        },
    ],
}


class H(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"[4096] {fmt % args}", flush=True)

    def _send(self, code, body):
        data = json.dumps(body, indent=2).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.startswith("/capabilities"):
            return self._send(200, CAPABILITIES)
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        try:
            body = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return self._send(400, {"error": "body must be JSON"})
        entry = {"at": time.time(), "path": self.path, "body": body}
        with open(LOG, "a") as f:
            f.write(json.dumps(entry) + "\n")
        return self._send(200, {"ok": True, "path": self.path, "received": body})


if __name__ == "__main__":
    print(f"integration stub on http://127.0.0.1:{PORT} -> {LOG}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
