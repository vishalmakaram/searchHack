"""pi agents: one builds process.py, one delivers its output."""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import threading
import time
import urllib.request

from . import core, events

# The output-integration proxy (output_integration/server.py) or any compatible one.
INTEGRATIONS = os.environ.get("INTEGRATIONS_URL", "http://127.0.0.1:4096")
DELIVERY_SERVICE = "sentinel-output-integration"
# Both agents run on the cheap model by default; override with PI_MODEL.
PI_MODEL = os.environ.get("PI_MODEL", "openrouter/deepseek/deepseek-v4.1-flash-1017")

PROCESS_CONTRACT = """\
`process.py` contract — this is the only contract that matters:

  stdin : ONE JSON object
          {"query": str, "url": str, "title": str, "content": str, "content_format": str}
  stdout: ONE JSON object
          {"keep": bool, "processed": str, "data": {...}}

  keep      false means "nothing new or nothing relevant" — the page stops here.
  processed the text a downstream agent reads. Under 800 characters. Written for a
            reader who has NOT seen the page: say what is new and why it matters.
  data      any structured fields you extracted (prices, dates, names, ids).

Hard rules:
  - Python 3.14 standard library only. No pip installs, no network, no LLM calls.
  - Deterministic. Same input, same output. No randomness, no clock.
  - Never raise: wrap the body in try/except and print a keep=false object on failure.
  - Handle empty or short content without crashing.
  - Finish in under 5 seconds.
"""


def _short(value, limit: int = 220) -> str:
    text = json.dumps(value, ensure_ascii=False) if not isinstance(value, str) else value
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _assistant_text(message: dict) -> str:
    blocks = message.get("content") or []
    return "".join(b.get("text", "") for b in blocks if b.get("type") == "text").strip()


def run_pi(prompt: str, cwd, timeout: int = 480, tools: str | None = None,
           log: object | None = None, on_line=None, agent: str = "agent",
           workspace: str | None = None) -> dict:
    """Run `pi -p --mode json`, stream its activity to `events`, and stay killable.

    The json stream is what makes the frontend interesting: tool calls arrive as they
    start, not when the agent finishes.
    """
    env = os.environ.copy()
    env["TELEM_API_KEY"] = core.api_key()
    cmd = ["pi", "-p", "--mode", "json", "--no-session", "--model", PI_MODEL]
    if tools:
        cmd += ["--tools", tools]

    started = time.time()
    handle = open(log, "w") if log else open(os.devnull, "w")
    proc = subprocess.Popen(
        cmd + [prompt], cwd=str(cwd), env=env, stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
    )
    timed_out = {"hit": False}

    def stop() -> None:
        timed_out["hit"] = True
        proc.kill()

    timer = threading.Timer(timeout, stop)
    timer.start()
    final_text = ""
    transcript: list[str] = []
    try:
        for raw in proc.stdout:
            handle.write(raw)
            handle.flush()
            line = raw.strip()
            if not line:
                continue
            event = None
            if line.startswith("{"):
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    event = None
            if event is None:
                if not line.startswith("Warning: Extension package"):
                    events.emit("agent", agent=agent, workspace=workspace, line=line)
                continue

            kind = event.get("type")
            if kind == "tool_execution_start":
                call = {"tool": event.get("toolName"), "args": _short(event.get("args"))}
                transcript.append(f"→ {call['tool']} {call['args']}")
                events.emit("agent", agent=agent, workspace=workspace, **call)
            elif kind == "message_end":
                message = event.get("message") or {}
                if message.get("role") == "assistant":
                    text = _assistant_text(message)
                    if text:
                        final_text = text
                        transcript.append(text)
                        events.emit("agent", agent=agent, workspace=workspace,
                                    line=text[-1500:])
            elif kind == "agent_end":
                events.emit("agent", agent=agent, workspace=workspace, phase="end")
    finally:
        timer.cancel()
        proc.wait()
        handle.close()

    ok = proc.returncode == 0 and not timed_out["hit"]
    return {
        "ok": ok,
        "rc": proc.returncode,
        "stdout": final_text,
        "transcript": "\n".join(transcript),
        "stderr": f"timed out after {timeout}s" if timed_out["hit"] else "",
        "duration_s": round(time.time() - started, 1),
    }


# ------------------------------------------------------------------ builder

def builder_prompt(query: str) -> str:
    return f"""\
You are building a monitor extractor for one query. Work only inside the current directory.

QUERY: {query}

The files already here:
  query.txt               the query
  fixtures/search.json    a real Telem search at tier "max" for this query — read it to learn
                          which sites and what fields actually come back
  fixtures/page.sample.json
                          a real normalized page record, exactly the object your process.py
                          will receive on stdin
  requirements.txt        empty; leave it empty unless you truly need a package
  process.py              does not exist yet — you write it

{PROCESS_CONTRACT}

Do this, in order:
1. Read fixtures/search.json and fixtures/page.sample.json. Note the real shape of things.
   If you want more evidence, you may call telem_search / telem_fetch once or twice.
2. Write process.py.
3. TEST it before you answer: `python process.py < fixtures/page.sample.json`
   It must exit 0 and print a single JSON object with "processed" and "keep".
   Fix and re-test until it does.
4. Reply with one short paragraph: what you extract and how you decide keep=false.

Write no other files. Do not create a README. Do not install packages."""


def repair_prompt(error: str) -> str:
    return f"""\
Your process.py failed verification on the real fixture.

{error}

Fix process.py in the current directory, test it with:
    python process.py < fixtures/page.sample.json
and reply DONE only when it prints valid JSON with "processed". Write nothing else."""


def build(ws: core.Workspace, query: str, tier: str = "max") -> dict:
    """Search, capture fixtures, have the builder agent write process.py, verify it."""
    t0 = time.time()
    result = {"query": query, "tier": tier, "steps": []}

    events.emit("build", workspace=ws.id, phase="search", query=query, tier=tier)
    resp = core.search(query, tier=tier, num_results=10)
    (ws.fixtures / "search.json").write_text(json.dumps(resp, indent=2))
    urls = core.search_urls(resp)
    result["steps"].append({"search": "ok", "urls": len(urls)})
    events.emit("build", workspace=ws.id, phase="searched", urls=len(urls))

    # Telem's per-provider ordering differs from ours: fetch a few top hits and keep
    # the richest page, so the builder sees a page that actually carries the content.
    events.emit("build", workspace=ws.id, phase="fetch", urls=urls[:4])
    candidates = []
    for url in urls[:4]:
        if url.lower().endswith(".pdf"):
            continue
        try:
            candidates.append(core.fetch(url))
        except Exception as e:  # try the next candidate
            result["steps"].append({"fetch_error": str(e)[:200], "url": url})
    page = max(candidates, key=lambda p: p["content_length"] or 0) if candidates else None
    if page is None:
        ws.save_status(status="failed", error="no fetchable result for query")
        return {**result, "ok": False, "error": "no fetchable result"}
    record = {"query": query, **page}
    (ws.fixtures / "page.sample.json").write_text(json.dumps(record, indent=2))
    result["steps"].append({"sample": page["url"], "content_length": page["content_length"]})

    events.emit("build", workspace=ws.id, phase="write", sample=page["url"],
                content_length=page["content_length"])
    agent = run_pi(builder_prompt(query), ws.path, log=ws.logs / "builder.out",
                   agent="builder", workspace=ws.id,
                   on_line=None)
    ws.log("builder", agent["stdout"] + "\n--- stderr ---\n" + agent["stderr"])
    result["steps"].append({"builder": agent["duration_s"], "builder_ok": agent["ok"]})

    events.emit("build", workspace=ws.id, phase="verify")
    check = ws.run_process(record)
    if not check.get("ok"):
        err = json.dumps({k: v for k, v in check.items() if k != "ok"})[:1500]
        ws.log("builder_repair", err)
        events.emit("build", workspace=ws.id, phase="repair", error=err[:600])
        agent2 = run_pi(repair_prompt(err), ws.path, timeout=240,
                        log=ws.logs / "builder_repair.out",
                        agent="builder", workspace=ws.id)
        ws.log("builder_repair_output", agent2["stdout"] + "\n" + agent2["stderr"])
        check = ws.run_process(record)
        result["steps"].append({"repair": agent2["duration_s"]})

    result["verify"] = {k: v for k, v in check.items() if k != "stderr"}
    ok = check.get("ok", False)
    ws.save_status(status="ready" if ok else "failed",
                   error=None if ok else check.get("error"),
                   sample=page["url"], built_at=time.time())
    events.emit("build", workspace=ws.id, phase="ready" if ok else "failed",
                seconds=round(time.time() - t0, 1), sample=page["url"],
                error=None if ok else str(check.get("error"))[:600])
    return {**result, "ok": ok}


# ------------------------------------------------------------------- worker

def _json_call(url: str, body: dict | None = None, timeout: int = 4):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        url, data=data, method="POST" if body is not None else "GET",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def capabilities() -> dict | None:
    """The real proxy answers POST /api/v1/capabilities; older stubs answered GET /capabilities."""
    try:
        payload = _json_call(f"{INTEGRATIONS}/api/v1/capabilities", {"include_schemas": False})
        if isinstance(payload, dict) and payload.get("service"):
            return payload
    except Exception:
        pass
    try:
        return _json_call(f"{INTEGRATIONS}/capabilities")
    except Exception:
        return None


def delivery_payload(ws_id: str, seq: int, page: dict, output: dict) -> dict:
    """Contract-3 ProcessedResult, filled from what the extractor produced."""
    data = output.get("data") or {}
    event_type = str(data.get("page_type") or "change")[:60]
    summary = (output.get("processed") or "").strip()[:500] or "change detected"
    dedupe = hashlib.sha256(f"{ws_id}:{event_type}:{summary.lower()}".encode()).hexdigest()
    return {
        "workspace_id": ws_id,
        "seq": seq,
        "extracted": {
            "event_type": event_type,
            "impact": "medium",
            "summary": summary,
            "source_url": page.get("canonical_url") or page.get("url"),
            "published_at": None,
        },
        "confidence": 0.9,
        "dedupe_key": dedupe,
        "raw_ref": f"telem://runs/{ws_id}/{seq}",
        "pipeline_version": "sentinel/0.1",
    }


def worker_prompt(query: str, page: dict, output: dict, caps: dict | None,
                  ws_id: str, seq: int) -> str:
    url = page.get("canonical_url") or page.get("url")
    head = f"""\
You are the delivery agent for a web monitor. You receive already-processed results and you
act on them. You do not browse the web and you do not rewrite the extractor.

MONITORED QUERY: {query}
WORKSPACE: {ws_id}
PAGE: {page.get('title') or '(untitled)'} — {url}

PROCESSED RESULT:
{output.get('processed') or '(empty)'}

EXTRACTED DATA:
{json.dumps(output.get('data') or {}, indent=2)[:2000]}
"""
    record = f"""\
1. Append to memory.md in the current directory (create it if missing) a section:
   "## <today's date> — <page title>", then 1-3 bullets: what is new, plus the source URL.
   Never delete or rewrite existing content; append only.
"""
    if caps and caps.get("service") == DELIVERY_SERVICE:
        body = f"""\
2. payload.json in this directory is a ready ProcessedResult ({seq=}). Send it to the output
   service exactly once:
     curl -sS -X POST {INTEGRATIONS}/api/v1/delivery/events \
       -H 'Content-Type: application/json' -d @payload.json
   Before sending you may only tighten `extracted.summary` (<=300 chars) and set
   `extracted.impact` to "low", "medium" or "high". Do not add, drop or reorder keys.
   Record the HTTP response next to the memory entry.
"""
    else:
        caps_text = json.dumps(caps, indent=2)[:4000] if caps else \
            "the integration server is not reachable right now"
        body = f"""\
2. Integrations available at {INTEGRATIONS}:
{caps_text}
   If, and only if, one of them clearly applies to this result, call it with curl
   (`curl -sS -X POST {INTEGRATIONS}/<path> -H 'Content-Type: application/json' -d '<json>'`).
   At most one integration call. If none applies, call none.
"""
    return head + record + body + """\
3. Print one line: what you recorded and which integration you called (or "none").

Do not ask questions. Do not create other files. Do not install anything.""" + "\n"


def deliver(ws: core.Workspace, query: str, page: dict, output: dict,
            timeout: int = 150) -> dict:
    caps = capabilities()
    status = ws.load_status()
    seq = int(status.get("seq") or 0) + 1
    # Hand the model a valid payload instead of asking it to invent JSON.
    payload_path = ws.path / "payload.json"
    if caps and caps.get("service") == DELIVERY_SERVICE:
        payload_path.write_text(json.dumps(delivery_payload(ws.id, seq, page, output), indent=2))
    else:
        payload_path.unlink(missing_ok=True)

    # No web tools: the worker acts on what it was given, nothing else.
    events.emit("delivery", workspace=ws.id, phase="start", url=page.get("url"),
                integrations=bool(caps), service=(caps or {}).get("service"))
    agent = run_pi(worker_prompt(query, page, output, caps, ws.id, seq), ws.path,
                   timeout=timeout, tools="bash,read,write,edit",
                   log=ws.logs / "worker.out", agent="worker", workspace=ws.id)
    ws.log("worker", agent["stdout"] + "\n--- stderr ---\n" + agent["stderr"])
    if agent["ok"]:
        ws.save_status(seq=seq)
    events.emit("delivery", workspace=ws.id, phase="done", ok=agent["ok"],
                seconds=agent["duration_s"], reply=agent["stdout"].strip()[-1200:])
    return {
        "ok": agent["ok"],
        "duration_s": agent["duration_s"],
        "reply": agent["stdout"].strip()[-2000:],
        "integrations_available": bool(caps),
        "service": (caps or {}).get("service"),
        "memory": ws.memory.read_text()[-3000:] if ws.memory.exists() else "",
    }
