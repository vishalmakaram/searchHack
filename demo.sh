#!/usr/bin/env bash
# End-to-end demo: query -> workspace + process.py -> run a page -> worker agent.
#   ./demo.sh "Telem AI changelog new features" https://docs.telem.ai/resources/changelog/
set -euo pipefail
cd "$(dirname "$0")"

QUERY="${1:-Telem AI changelog new features}"
URL="${2:-https://docs.telem.ai/resources/changelog/}"
BASE=http://127.0.0.1:8000

curl -sf "$BASE/health" >/dev/null || {
  echo "server down. start it with:"
  echo "  PYTHONPATH=. .venv/bin/python -m sentinel.server &"
  exit 1
}

echo "== creating workspace for: $QUERY"
WS=$(curl -sS -X POST "$BASE/workspaces" -H 'Content-Type: application/json' \
      -d "$(jq -nc --arg q "$QUERY" '{query:$q}')" | jq -r .id)
echo "   workspace: $WS"

echo "== waiting for the builder agent to write process.py"
for _ in $(seq 1 60); do
  S=$(curl -sS "$BASE/workspaces/$WS" | jq -r .status.status)
  case "$S" in ready) echo "   ready"; break;; failed) echo "   FAILED"; exit 1;; esac
  sleep 4
done

echo "== running one page through process.py + the worker agent"
curl -sS -X POST "$BASE/workspaces/$WS/run" -H 'Content-Type: application/json' \
  -d "$(jq -nc --arg u "$URL" '{url:$u}')" \
| jq '{ok, page: .page.title,
       processed: .process.output.processed,
       ms: .process.duration_ms,
       delivery: {ok: .delivery.ok, secs: .delivery.duration_s, reply: .delivery.reply}}'

echo "== memory.md"
curl -sS "$BASE/workspaces/$WS/memory" | jq -r .memory
