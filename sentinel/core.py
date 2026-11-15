"""Core runtime: Telem client, workspace lifecycle, process.py execution."""
from __future__ import annotations

import json
import os
import re
import subprocess
import time
import traceback
import urllib.error
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKSPACES = ROOT / "workspaces"
UV = ROOT / "bin" / "uv"
TELEM_BASE = os.environ.get("TELEM_BASE", "https://router.telem.ai")
# Cloudflare in front of the router rejects the default Python-urllib UA with 403/1010.
USER_AGENT = "sentinel/0.1"
PYTHON_VERSION = "3.14"

WORKSPACES.mkdir(exist_ok=True)


# ---------------------------------------------------------------- credentials

def _load_env() -> None:
    env_file = ROOT / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def api_key() -> str:
    _load_env()
    key = os.environ.get("TELEM_API_KEY")
    if key:
        return key
    creds = Path.home() / ".telem" / "credentials.json"
    if creds.exists():
        return json.loads(creds.read_text())["apiKey"]
    raise RuntimeError("no TELEM_API_KEY and no ~/.telem/credentials.json")


# ------------------------------------------------------------------- telem

def _post(path: str, body: dict, timeout: int = 90) -> dict:
    req = urllib.request.Request(
        TELEM_BASE + path,
        data=json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {api_key()}",
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        detail = e.read()[:800].decode(errors="replace")
        raise RuntimeError(f"telem {path} HTTP {e.code}: {detail}") from None


def _get(path: str, timeout: int = 60) -> dict:
    req = urllib.request.Request(
        TELEM_BASE + path,
        headers={"Authorization": f"Bearer {api_key()}", "User-Agent": USER_AGENT},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def search(query: str, tier: str = "max", num_results: int = 10) -> dict:
    """Real Telem search at the requested tier. Returns the raw response."""
    return _post("/v1/search", {
        "user_input": {"query": query},
        "search": {"tier": tier, "num_results": num_results},
    })


def search_items(resp: dict) -> list[dict]:
    """Flatten `preprocessor_runs[].output_payload.results[]`, cross-provider first."""
    order: dict[str, int] = {}
    hits: dict[str, int] = {}
    items: dict[str, dict] = {}
    for run in resp.get("preprocessor_runs") or []:
        for item in ((run.get("output_payload") or {}).get("results") or []):
            url = item.get("url")
            if not url:
                continue
            order.setdefault(url, len(order))
            hits[url] = hits.get(url, 0) + 1
            best = items.get(url)
            if best is None or (item.get("rank") or 99) < (best.get("rank") or 99):
                items[url] = item
    ranked = sorted(items, key=lambda u: (-hits[u], order[u]))
    return [items[u] for u in ranked]


def search_urls(resp: dict) -> list[str]:
    return [i["url"] for i in search_items(resp)]


def fetch(url: str) -> dict:
    """Fetch one page through Telem and normalize it into the page record."""
    resp = _post("/v1/fetch", {"urls": [url]}, timeout=120)
    runs = resp.get("preprocessor_runs") or []
    results = []
    for run in runs:
        results.extend((run.get("output_payload") or {}).get("fetched_results") or [])
    if not results:
        raise RuntimeError(f"telem fetch returned no results for {url}")
    r = results[0]
    if r.get("error"):
        raise RuntimeError(f"telem fetch failed for {url}: {r['error']}")
    return {
        "url": r.get("url") or url,
        "canonical_url": r.get("canonical_url") or url,
        "title": r.get("title") or "",
        "content": r.get("content") or "",
        "content_format": r.get("content_format") or "text",
        "content_length": r.get("content_length") or 0,
        "content_sha256": r.get("content_sha256"),
        "cached": r.get("cached"),
        "provider": r.get("provider"),
        "http_status": r.get("http_status"),
    }


# --------------------------------------------------------------- monitor

def create_monitor(query: str, frequency: str = "1h", ttl: str = "1h") -> dict:
    return _post("/v1/monitors", {
        "query": query,
        "options": {"frequency": frequency, "search": {"tier": "default", "num_results": 5}},
        "ttl": ttl,
    })


def poll_monitor(monitor_id: str) -> dict:
    """One-shot snapshot search. Items an agent has already found are not repeated here."""
    return _post(f"/v1/monitors/{monitor_id}/poll", {})


def monitor_changes(monitor_id: str, limit: int = 50) -> dict:
    """The monitor agent's change feed: entity_added / value_changed / tick, oldest first."""
    return _get(f"/v1/monitors/{monitor_id}/agent/changes?limit={limit}")


def change_items(feed: dict) -> list[dict]:
    """entity_added changes that carry a URL, as items shaped like search results."""
    items = []
    for change in feed.get("changes") or []:
        if change.get("kind") != "entity_added":
            continue
        after = change.get("after") or {}
        url = after.get("url")
        if not url:
            continue
        items.append({"url": url, "title": (change.get("subject") or {}).get("name") or url,
                      "seq": change.get("seq"), "kind": after.get("kind")})
    return items


# -------------------------------------------------------------- workspace

def slug(query: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", query.lower()).strip("-")[:40]
    return f"{s or 'ws'}-{uuid.uuid4().hex[:6]}"


class Workspace:
    def __init__(self, ws_id: str):
        self.id = ws_id
        self.path = WORKSPACES / ws_id

    # ---- paths
    @property
    def process_py(self) -> Path: return self.path / "process.py"
    @property
    def memory(self) -> Path: return self.path / "memory.md"
    @property
    def fixtures(self) -> Path: return self.path / "fixtures"
    @property
    def status_file(self) -> Path: return self.path / "status.json"
    @property
    def logs(self) -> Path: return self.path / "logs"
    @property
    def python(self) -> Path: return self.path / ".venv" / "bin" / "python"

    # ---- creation
    @classmethod
    def create(cls, query: str) -> "Workspace":
        ws = cls(slug(query))
        for d in (ws.path, ws.fixtures, ws.logs):
            d.mkdir(parents=True, exist_ok=True)
        (ws.path / "query.txt").write_text(query)
        (ws.path / "requirements.txt").write_text("")
        ws.memory.write_text(f"# Memory: {query}\n\n")
        ws.save_status(status="creating", query=query, created_at=time.time())
        ws.make_venv()
        return ws

    def make_venv(self) -> None:
        subprocess.run(
            [str(UV), "venv", "--python", PYTHON_VERSION, str(self.path / ".venv")],
            check=True, capture_output=True, text=True,
        )
        req = (self.path / "requirements.txt").read_text().strip()
        if req:
            self.install_requirements()

    def install_requirements(self) -> None:
        subprocess.run(
            [str(UV), "pip", "install", "--python", str(self.python),
             "-r", str(self.path / "requirements.txt")],
            check=True, capture_output=True, text=True, timeout=300,
        )

    # ---- status
    def save_status(self, **kw) -> None:
        cur = self.load_status()
        cur.update(kw)
        self.status_file.write_text(json.dumps(cur, indent=2))

    def load_status(self) -> dict:
        if self.status_file.exists():
            try:
                return json.loads(self.status_file.read_text())
            except json.JSONDecodeError:
                return {}
        return {}

    def log(self, name: str, text: str) -> None:
        (self.logs / f"{name}.log").write_text(text)

    # ---- process.py
    def run_process(self, page: dict, timeout: int = 90) -> dict:
        """Feed one page record to process.py; return {ok, output|error, stderr}."""
        if not self.process_py.exists():
            return {"ok": False, "error": "process.py missing"}
        started = time.time()
        try:
            p = subprocess.run(
                [str(self.python), str(self.process_py)],
                input=json.dumps(page),
                capture_output=True, text=True, timeout=timeout, cwd=self.path,
            )
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": f"process.py timed out after {timeout}s"}
        dur = round((time.time() - started) * 1000)
        if p.returncode != 0:
            return {"ok": False, "error": f"exit {p.returncode}",
                    "stderr": p.stderr[-2000:], "duration_ms": dur}
        try:
            out = json.loads(p.stdout.strip().splitlines()[-1])
        except (json.JSONDecodeError, IndexError):
            return {"ok": False, "error": "stdout was not one JSON object",
                    "stdout": p.stdout[-1500:], "stderr": p.stderr[-1500:],
                    "duration_ms": dur}
        if not isinstance(out, dict):
            return {"ok": False, "error": "process.py must print a JSON object",
                    "duration_ms": dur}
        return {"ok": True, "output": out, "stderr": p.stderr[-1500:], "duration_ms": dur}
