"""Ask several search engines at once through Telem, and save their answers.

search_all(question) returns a dict like:
    {"exa": [result, result, ...], "tavily": [...], "brave": [...]}
Each list is in the engine's own rank order (best first).
Each result is a small dict: {"rank", "title", "url", "text", "provider"}.

Raw responses are saved as JSON in cache/, one file per (question, provider),
so running the same question again costs no search credits.
"""

import hashlib
import json
import os
import re
from pathlib import Path

from dotenv import load_dotenv
from telem import Telem

# Read TELEM_API_KEY from the .env file. We never print the key.
load_dotenv()

# The engines we compare. These are Telem's exact provider names.
PROVIDERS = ["exa", "tavily", "brave"]

# How many results to ask each engine for.
NUM_RESULTS = 10

# cache/ lives at the project root, next to app.py.
CACHE_DIR = Path(__file__).resolve().parent.parent / "cache"


def _cache_path(question, provider):
    """Pick a file name for one question + one provider."""
    clean = question.strip().lower()
    # A short readable slug, plus a hash so different questions never clash.
    slug = re.sub(r"[^a-z0-9]+", "-", clean)[:50].strip("-")
    digest = hashlib.sha1(clean.encode("utf-8")).hexdigest()[:10]
    return CACHE_DIR / f"{slug}-{digest}__{provider}.json"


def _page_text(row):
    """Get the best text we have for one result row.

    Full page content comes first, because the eval checks whole pages.
    If it is missing, fall back to the summary, then the excerpts.
    """
    full = row.get("full_content") or {}
    if isinstance(full, dict) and full.get("content"):
        return str(full["content"])
    if row.get("summary"):
        return str(row["summary"])
    return " ".join(row.get("excerpt") or [])


def _simplify(rows, provider):
    """Turn raw result rows into small dicts, in rank order."""
    # Sort by the engine's rank when it gives one. Rows without a rank keep
    # their original order (Python's sort is stable).
    rows = sorted(rows, key=lambda r: r.get("rank") if r.get("rank") is not None else 10**6)
    results = []
    for position, row in enumerate(rows, start=1):
        if not row.get("url"):
            continue
        results.append(
            {
                "rank": position,
                "title": row.get("title") or row["url"],
                "url": row["url"],
                "text": _page_text(row),
                "provider": provider,
            }
        )
    return results


def _fetch_from_telem(question, providers):
    """Make ONE Telem call that asks every provider in `providers` at once.

    Returns {provider: cache_record}. A record holds the raw result rows plus
    the run's status and error, so we can see when an engine failed.
    """
    if not os.getenv("TELEM_API_KEY"):
        raise RuntimeError("TELEM_API_KEY is not set. Add it to the .env file.")

    with Telem() as client:
        response = client.search(
            question,
            providers_include=providers,
            num_results=NUM_RESULTS,
            include_full_content=True,  # whole-page text, so the eval can check it
        )

    records = {}
    for run in response.by_provider:
        records[run.provider] = {
            "question": question,
            "provider": run.provider,
            "status": run.status,
            "error": run.error,
            "latency_ms": run.latency_ms,
            # result.raw is the row exactly as Telem sent it.
            "results": [result.raw for result in run.results],
        }
    return records


def search_all(question, providers=PROVIDERS):
    """Search every provider for `question`. Uses the cache when it can."""
    CACHE_DIR.mkdir(exist_ok=True)
    records = {}
    missing = []

    # 1. Load whatever is already cached.
    for provider in providers:
        path = _cache_path(question, provider)
        if path.exists():
            records[provider] = json.loads(path.read_text())
        else:
            missing.append(provider)

    # 2. Ask Telem only for the providers we don't have yet (one call).
    if missing:
        fresh = _fetch_from_telem(question, missing)
        for provider in missing:
            record = fresh.get(provider)
            if record is None:
                record = {"provider": provider, "status": "missing", "error": "No run returned", "results": []}
            records[provider] = record
            # Only cache runs that worked, so a failed engine is retried next time.
            if record["results"]:
                _cache_path(question, provider).write_text(json.dumps(record, indent=1))

    # 3. Return simple, rank-ordered results for each provider.
    return {provider: _simplify(records[provider]["results"], provider) for provider in providers}


def search_status(question, providers=PROVIDERS):
    """Report each provider's status and error from the cache (for debugging)."""
    status = {}
    for provider in providers:
        path = _cache_path(question, provider)
        if path.exists():
            record = json.loads(path.read_text())
            status[provider] = (record.get("status"), record.get("error"))
        else:
            status[provider] = ("not cached", None)
    return status
