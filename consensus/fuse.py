"""Merge several engines' rankings into one list with reciprocal rank fusion (RRF).

The idea: a page gets points from every engine that returned it.
An engine's #1 result is worth 1/(60+1), its #2 is worth 1/(60+2), and so on.
A page that three engines agree on beats a page only one engine liked,
even if that one engine ranked it #1.
"""

from urllib.parse import parse_qsl, urlencode, urlsplit

# The "60" in 1/(60 + rank). It is the standard value from the original RRF paper.
# Bigger numbers make the gap between rank 1 and rank 10 smaller.
K = 60

# Query parameters that only track clicks. They don't change the page.
TRACKING_PARAMS = {
    "gclid", "fbclid", "msclkid", "yclid", "igshid", "mc_cid", "mc_eid",
    "ref", "ref_src", "srsltid", "_ga", "_gl",
}


def normalize_url(url):
    """Make two links to the same page look identical.

    - drop http/https (same page either way)
    - lowercase the host and drop "www."
    - drop the trailing slash
    - drop tracking parameters (utm_*, gclid, ...)
    - drop the "#..." part (it only scrolls within a page)
    """
    parts = urlsplit(url.strip())
    host = parts.netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    path = parts.path.rstrip("/")
    kept = [
        (key, value)
        for key, value in parse_qsl(parts.query, keep_blank_values=True)
        if not key.lower().startswith("utm_") and key.lower() not in TRACKING_PARAMS
    ]
    query = urlencode(kept)
    return host + path + ("?" + query if query else "")


def fuse(results_by_engine, k=K):
    """Merge {engine: [results in rank order]} into one ranked list.

    Each merged item looks like:
        {"url", "title", "text", "score", "engines": ["exa", "brave"], "ranks": {"exa": 1, "brave": 4}}
    """
    merged = {}

    for engine, results in results_by_engine.items():
        seen_by_this_engine = set()
        for rank, result in enumerate(results, start=1):
            key = normalize_url(result["url"])
            # An engine can only vote once for the same page.
            if not key or key in seen_by_this_engine:
                continue
            seen_by_this_engine.add(key)

            if key not in merged:
                merged[key] = {
                    "url": result["url"],
                    "title": result["title"],
                    "text": result["text"],
                    "score": 0.0,
                    "engines": [],
                    "ranks": {},
                }
            item = merged[key]
            item["score"] += 1 / (k + rank)
            item["engines"].append(engine)
            item["ranks"][engine] = rank
            # Keep the longest page text any engine gave us for this URL.
            if len(result["text"]) > len(item["text"]):
                item["text"] = result["text"]

    # Highest score first.
    return sorted(merged.values(), key=lambda item: item["score"], reverse=True)
