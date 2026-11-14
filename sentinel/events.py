"""Event hub: one JSON object per line, fanned out to every `/ws` client.

Nothing here knows about HTTP. `emit()` is safe to call from any thread; the
websocket handler in `server.py` subscribes and forwards. A late client gets a
short backlog, so a frontend opened mid-build still sees what happened.
"""
from __future__ import annotations

import json
import queue
import threading
import time

MAX_HISTORY = 400
MAX_BACKLOG = 80
MAX_LINE = 4000

_history: list[str] = []
_clients: set[queue.Queue] = set()
_lock = threading.Lock()


def _line(event: dict) -> str:
    line = json.dumps(event, ensure_ascii=False, default=str)
    if len(line) > MAX_LINE:
        trimmed = dict(event)
        for key, value in trimmed.items():
            if isinstance(value, str) and len(value) > 600:
                trimmed[key] = value[:600] + "…"
        line = json.dumps(trimmed, ensure_ascii=False, default=str)[:MAX_LINE]
    return line


def emit(kind: str, **fields) -> dict:
    """Record one event and push it to every subscriber."""
    event = {"type": kind, "at": round(time.time(), 3), **fields}
    line = _line(event)
    with _lock:
        _history.append(line)
        del _history[:-MAX_HISTORY]
        for client in list(_clients):
            client.put(line)
    return event


def subscribe() -> tuple[queue.Queue, list[str]]:
    client: queue.Queue = queue.Queue()
    with _lock:
        backlog = list(_history[-MAX_BACKLOG:])
        _clients.add(client)
    return client, backlog


def unsubscribe(client: queue.Queue) -> None:
    with _lock:
        _clients.discard(client)


def client_count() -> int:
    with _lock:
        return len(_clients)


def snapshot(limit: int = MAX_BACKLOG) -> list[str]:
    with _lock:
        return list(_history[-limit:])
