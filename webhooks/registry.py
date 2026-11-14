"""Remember which webhook link belongs to which Telem monitor.

Every monitor gets its own secret link:  <PUBLIC_BASE_URL>/telem/<token>
We save   token -> {monitor_id, secret, query}   in data/webhooks.json
so the server can check that a delivery really came from Telem.

data/ is in .gitignore: the secrets never go into git.
"""

import json
import secrets
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
REGISTRY_FILE = DATA_DIR / "webhooks.json"


def new_token():
    """A long random string, so nobody can guess a webhook link."""
    return secrets.token_urlsafe(16)


def load():
    """Read every saved webhook. Returns {} if there are none yet."""
    if not REGISTRY_FILE.exists():
        return {}
    return json.loads(REGISTRY_FILE.read_text())


def save_webhook(token, monitor_id, secret, query):
    """Add (or replace) one webhook in the registry file."""
    DATA_DIR.mkdir(exist_ok=True)
    registry = load()
    registry[token] = {"monitor_id": monitor_id, "secret": secret, "query": query}
    REGISTRY_FILE.write_text(json.dumps(registry, indent=1))
    REGISTRY_FILE.chmod(0o600)  # only your user can read the secrets


def find(token):
    """Look up one webhook by its token. Returns None if it is unknown."""
    return load().get(token)
