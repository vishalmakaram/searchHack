"""HTTP API: create a workspace from a query, then feed pages through it."""
from __future__ import annotations

import base64
import hashlib
import json
import os
import queue
import socket
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import agents, core, events

PORT = int(os.environ.get("PORT", "8000"))
# 0.0.0.0 so the dashboard is reachable over tailscale/LAN; localhost still works.
HOST = os.environ.get("HOST", "0.0.0.0")
_lock = threading.RLock()  # reentrant: pipeline -> record_page


WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def ws_frame(payload: bytes, opcode: int = 0x1) -> bytes:
    header = bytes([0x80 | opcode])
    n = len(payload)
    if n < 126:
        header += bytes([n])
    elif n < 65536:
        header += bytes([126]) + n.to_bytes(2, "big")
    else:
        header += bytes([127]) + n.to_bytes(8, "big")
    return header + payload


def recv_exact(sock: socket.socket, n: int) -> bytes:
    chunks = b""
    while len(chunks) < n:
        chunk = sock.recv(n - len(chunks))
        if not chunk:
            raise ConnectionError("peer closed")
        chunks += chunk
    return chunks


def ws_read(sock: socket.socket) -> tuple[int, bytes]:
    head = recv_exact(sock, 2)
    opcode = head[0] & 0x0F
    masked = head[1] & 0x80
    n = head[1] & 0x7F
    if n == 126:
        n = int.from_bytes(recv_exact(sock, 2), "big")
    elif n == 127:
        n = int.from_bytes(recv_exact(sock, 8), "big")
    mask = recv_exact(sock, 4) if masked else b""
    data = recv_exact(sock, n) if n else b""
    if masked:
        data = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
    return opcode, data


def background_build(ws: core.Workspace, query: str) -> None:
    try:
        out = agents.build(ws, query)
        ws.save_status(build=out)
        if out.get("ok"):
            # Seed the pipeline straight away: a monitor that has just been created has
            # no finds yet, so a fresh workspace would otherwise show nothing until the
            # next tick. This runs a real search and processes the first pages.
            ws.save_status(last_collect=collect(ws))
    except Exception as e:
        ws.save_status(status="failed", error=f"{e}\n{traceback.format_exc()[-1500:]}")


def pipeline(ws: core.Workspace, url: str, page: dict | None = None) -> dict:
    """fetch → process.py → worker agent. This is the whole product."""
    query = (ws.path / "query.txt").read_text().strip()
    out: dict = {"workspace": ws.id, "url": url}
    events.emit("run", workspace=ws.id, phase="fetch", url=url)
    page = page or core.fetch(url)
    out["page"] = {k: page[k] for k in ("title", "content_length", "cached", "provider")}
    chars_in = page["content_length"] or len(page.get("content") or "")
    events.emit("run", workspace=ws.id, phase="fetched", url=url,
                title=page["title"], content_length=chars_in, chars_in=chars_in,
                cached=page.get("cached"), provider=page.get("provider"))
    proc = ws.run_process({"query": query, **page})
    processed = ((proc.get("output") or {}).get("processed")) or ""
    chars_out = len(processed)
    ratio = round(chars_in / chars_out, 1) if chars_out else None
    saved_pct = round(100 * (1 - chars_out / chars_in)) if chars_in and chars_out else None
    events.emit("run", workspace=ws.id, phase="processed", url=url,
                ok=proc.get("ok"), duration_ms=proc.get("duration_ms"),
                keep=(proc.get("output") or {}).get("keep"),
                chars_in=chars_in, chars_out=chars_out, ratio=ratio, saved_pct=saved_pct,
                processed=processed)
    out["process"] = {k: v for k, v in proc.items() if k != "stderr"}
    out["chars_in"], out["chars_out"] = chars_in, chars_out
    out["ratio"], out["saved_pct"] = ratio, saved_pct
    if not proc.get("ok"):
        out["ok"] = False
        out["error"] = "process.py failed"
        return out
    result = proc["output"]
    if not result.get("keep", True):
        out.update(ok=True, dropped=True, reason=result.get("processed") or "keep=false")
        events.emit("run", workspace=ws.id, phase="dropped", url=url,
                    reason=out["reason"][:400])
        with _lock:
            record_page(ws, page, chars_in, chars_out, result, {},
                        out.get("ratio"), out.get("saved_pct"), note="dropped")
        return out
    # The worker agent costs a model call, so only wake it when the extraction
    # actually changed since the last time this URL was processed.
    fp = hashlib.sha256((result.get("processed") or "").encode()).hexdigest()[:16]
    with _lock:
        seen_fp = dict(ws.load_status().get("fingerprints") or {})
    out["fingerprint"] = fp
    if seen_fp.get(url) == fp:
        out.update(ok=True, unchanged=True, reason="processed text unchanged since last run")
        events.emit("run", workspace=ws.id, phase="unchanged", url=url, fingerprint=fp)
        with _lock:
            record_page(ws, page, chars_in, chars_out, result, {},
                        out.get("ratio"), out.get("saved_pct"), note="unchanged")
        return out
    out["delivery"] = agents.deliver(ws, query, page, result)
    out["ok"] = True
    with _lock:
        record_page(ws, page, chars_in, chars_out, result, out["delivery"],
                out.get("ratio"), out.get("saved_pct"))
        ws.save_status(fingerprints={**seen_fp, url: fp})
    return out


def record_page(ws: core.Workspace, page: dict, chars_in: int, chars_out: int,
                result: dict, delivery: dict, ratio: float | None = None,
                saved_pct: int | None = None, note: str | None = None) -> None:
    """A compact per-page log so a UI can show what the pipeline actually did."""
    with _lock:
        pages = list(ws.load_status().get("pages") or [])
    pages.insert(0, {
        "url": page.get("canonical_url") or page.get("url"),
        "title": (page.get("title") or "")[:160],
        "chars_in": chars_in,
        "chars_out": chars_out,
        "ratio": ratio,
        "saved_pct": saved_pct,
        "keep": bool(result.get("keep", True)),
        "ok": bool(delivery.get("ok")),
        "note": note or ("delivered" if delivery else "processed"),
        "seconds": delivery.get("duration_s"),
        "at": time.time(),
    })
    with _lock:
        ws.save_status(pages=pages[:25])


def collect(ws: core.Workspace, max_pages: int = 3) -> dict:
    """Ask Telem's monitor what is new, then run each new page through the pipeline."""
    query = (ws.path / "query.txt").read_text().strip()
    status = ws.load_status()
    monitor_id = status.get("monitor_id")
    out: dict = {"workspace": ws.id, "query": query}
    if not monitor_id:
        mon = core.create_monitor(query)
        monitor_id = mon.get("id") or mon.get("monitor_id")
        ws.save_status(monitor_id=monitor_id)
        out["created_monitor"] = monitor_id
    out["monitor_id"] = monitor_id

    # The monitor agent's change feed is the real item source: entity_added carries the
    # URL it found. Poll is a one-shot snapshot search and comes back empty once the
    # agent has already seen those pages, so it is only a fallback.
    since = int(status.get("changes_seq") or 0)
    source = "monitor"
    items: list[dict] = []
    try:
        feed = core.monitor_changes(monitor_id)
        (ws.fixtures / "changes.json").write_text(json.dumps(feed, indent=2))
        items = [i for i in core.change_items(feed) if (i.get("seq") or 0) > since]
        out["watermark"] = feed.get("watermark")
        events.emit("collect", workspace=ws.id, phase="changes", monitor_id=monitor_id,
                    count=len(items), watermark=feed.get("watermark"))
    except Exception as e:  # noqa: BLE001 — a feed hiccup must not kill the collect
        out["changes_error"] = str(e)[:200]

    if not items:
        polled = core.poll_monitor(monitor_id)
        (ws.fixtures / "poll.json").write_text(json.dumps(polled, indent=2))
        items = core.search_items(polled)
        source = "poll"
        events.emit("collect", workspace=ws.id, phase="polled", monitor_id=monitor_id)

    if not items:
        # A monitor still compiling has neither changes nor snapshot items. Escalate
        # with a search for the same query rather than returning nothing.
        escalated = core.search(query, tier="extended", num_results=10)
        (ws.fixtures / "escalation.json").write_text(json.dumps(escalated, indent=2))
        items = core.search_items(escalated)
        source = "escalation"
    out["source"] = source

    seen = set(status.get("seen_urls") or [])
    unseen = [i for i in items if i.get("url") and i["url"] not in seen]
    fresh = unseen[:max_pages]
    out["new_items"] = len(fresh)
    events.emit("collect", workspace=ws.id, phase="new_items", source=out["source"],
                count=len(fresh), urls=[i.get("url") for i in fresh])
    out["results"] = [pipeline(ws, i["url"]) for i in fresh]
    # Only consume the watermark once every unseen item has been run; with more items
    # than max_pages, leave the rest queued for the next collect.
    cap_hit = len(unseen) > len(fresh)
    consumed = max((i.get("seq") or 0) for i in fresh) if cap_hit and fresh else 0
    ws.save_status(seen_urls=sorted(seen | {i["url"] for i in fresh}),
                   changes_seq=consumed or out.get("watermark") or status.get("changes_seq") or 0)
    return out


class Handler(BaseHTTPRequestHandler):
    server_version = "sentinel/0.1"
    protocol_version = "HTTP/1.1"

    def _ws(self) -> None:
        """Push every event as a JSON line. One blocking reader thread per client."""
        key = self.headers.get("Sec-WebSocket-Key") or ""
        accept = base64.b64encode(
            hashlib.sha1((key + WS_GUID).encode()).digest()
        ).decode()
        self.send_response(101, "Switching Protocols")
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept)
        self.end_headers()
        self.wfile.flush()

        sock = self.connection
        client, backlog = events.subscribe()
        stop = threading.Event()

        def pump() -> None:
            while not stop.is_set():
                try:
                    line = client.get(timeout=0.5)
                except queue.Empty:
                    continue
                try:
                    sock.sendall(ws_frame(line.encode()))
                except OSError:
                    break
            stop.set()

        events.emit("ws", phase="connected", clients=events.client_count())
        try:
            for line in backlog:
                sock.sendall(ws_frame(line.encode()))
            threading.Thread(target=pump, daemon=True).start()
            while not stop.is_set():
                opcode, data = ws_read(sock)
                if opcode == 0x8:
                    break
                if opcode == 0x9:
                    sock.sendall(ws_frame(data, 0xA))
        except (OSError, ConnectionError):
            pass
        finally:
            stop.set()
            self.close_connection = True
            events.unsubscribe(client)

    def log_message(self, fmt, *args):  # quieter, one line per request
        print(f"{self.address_string()} {fmt % args}", flush=True)

    # ---- helpers
    def _json(self, code: int, body: dict) -> None:
        data = json.dumps(body, indent=2).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _body(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return {}
        return json.loads(self.rfile.read(n) or b"{}")

    # ---- routes
    def do_GET(self):
        parts = [p for p in self.path.split("?")[0].split("/") if p]
        try:
            if parts == ["health"]:
                return self._json(200, {"ok": True})
            if parts == ["ws"]:
                return self._ws()
            if not parts or parts == ["index.html"]:
                page = (core.ROOT / "sentinel" / "status.html").read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(page)))
                self.end_headers()
                self.wfile.write(page)
                return
            if parts == ["workspaces"]:
                return self._json(200, {"workspaces": [
                    p.name for p in sorted(core.WORKSPACES.iterdir()) if p.is_dir()
                ]})
            if len(parts) == 2 and parts[0] == "workspaces":
                ws = core.Workspace(parts[1])
                if not ws.path.exists():
                    return self._json(404, {"error": "no such workspace"})
                return self._json(200, {"id": ws.id, "status": ws.load_status(),
                                        "memory": ws.memory.read_text() if ws.memory.exists() else ""})
            if len(parts) == 3 and parts[0] == "workspaces" and parts[2] == "memory":
                ws = core.Workspace(parts[1])
                return self._json(200, {"id": ws.id,
                                        "memory": ws.memory.read_text() if ws.memory.exists() else ""})
            return self._json(404, {"error": "not found"})
        except Exception as e:
            return self._json(500, {"error": str(e), "trace": traceback.format_exc()[-1200:]})

    def do_POST(self):
        parts = [p for p in self.path.split("?")[0].split("/") if p]
        try:
            body = self._body()
            if parts == ["workspaces"]:
                query = (body.get("query") or "").strip()
                if not query:
                    return self._json(400, {"error": "query required"})
                ws = core.Workspace.create(query)
                events.emit("workspace", workspace=ws.id, query=query, phase="created")
                threading.Thread(target=background_build, args=(ws, query), daemon=True).start()
                return self._json(202, {"id": ws.id, "status": "building",
                                        "poll": f"/workspaces/{ws.id}"})
            if len(parts) == 3 and parts[0] == "workspaces" and parts[2] == "run":
                ws = core.Workspace(parts[1])
                if not ws.path.exists():
                    return self._json(404, {"error": "no such workspace"})
                url = (body.get("url") or "").strip()
                if not url:
                    return self._json(400, {"error": "url required"})
                return self._json(200, pipeline(ws, url))
            if len(parts) == 3 and parts[0] == "workspaces" and parts[2] == "collect":
                return self._json(200, collect(core.Workspace(parts[1])))
            return self._json(404, {"error": "not found"})
        except Exception as e:
            return self._json(500, {"error": str(e), "trace": traceback.format_exc()[-1200:]})


def sweep_interrupted() -> None:
    """A build runs in a thread, so a restart leaves its workspace stuck in 'creating'."""
    for path in core.WORKSPACES.iterdir():
        if not path.is_dir():
            continue
        ws = core.Workspace(path.name)
        status = ws.load_status()
        if status.get("status") in ("creating", "building"):
            ws.save_status(status="interrupted", error="server restarted mid-build")


def main() -> None:
    sweep_interrupted()
    print(f"sentinel on http://{HOST}:{PORT}  workspaces={core.WORKSPACES}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
