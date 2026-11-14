"""Does consensus search beat every single engine? This script measures it.

For each question we look at the top 3 and top 5 results of each engine,
and of the consensus (fused) list:
    hit@3 = 1 if ANY of the top 3 pages contains ALL the answer terms, else 0
    hit@5 = the same for the top 5
We also report the average word count of the top 3 pages: a rough measure of
how much text an AI would have to read.

Run it from the project root:
    .venv/bin/python eval/run_eval.py
It prints a table and saves eval/results.json.
"""

import json
import sys
from pathlib import Path

# Let this script import from the project root (consensus/) and from eval/.
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from consensus.engines import PROVIDERS, search_all  # noqa: E402
from consensus.fuse import fuse  # noqa: E402
from eval.questions import load_questions  # noqa: E402

RESULTS_FILE = ROOT / "eval" / "results.json"
CONSENSUS = "consensus"


def page_has_answer(text, answer_terms):
    """True if the page text contains every answer term (ignoring case)."""
    text = text.lower()
    return all(term.lower() in text for term in answer_terms)


def hit_at_k(results, answer_terms, k):
    """1 if any of the top-k results contains the answer, else 0."""
    return int(any(page_has_answer(r["text"], answer_terms) for r in results[:k]))


def avg_words_top3(results):
    """Average number of words in the top 3 pages (0 if there are none)."""
    top = results[:3]
    if not top:
        return 0
    return sum(len(r["text"].split()) for r in top) / len(top)


def evaluate(questions, search=search_all, engines=PROVIDERS):
    """Score every engine plus consensus on every question."""
    systems = list(engines) + [CONSENSUS]
    per_question = []

    for q in questions:
        print(f"  searching: {q['id']}", file=sys.stderr)
        lists = search(q["question"])               # {engine: [results]}
        lists[CONSENSUS] = fuse({e: lists[e] for e in engines})

        row = {"id": q["id"], "question": q["question"], "answer_terms": q["answer_terms"], "systems": {}}
        for system in systems:
            results = lists.get(system, [])
            row["systems"][system] = {
                "hit@3": hit_at_k(results, q["answer_terms"], 3),
                "hit@5": hit_at_k(results, q["answer_terms"], 5),
                "avg_words_top3": round(avg_words_top3(results)),
                "num_results": len(results),
                "top5_urls": [r["url"] for r in results[:5]],
            }
        per_question.append(row)

    # Average each number over all questions.
    summary = {}
    n = len(per_question) or 1
    for system in systems:
        scores = [row["systems"][system] for row in per_question]
        summary[system] = {
            "hit@3": sum(s["hit@3"] for s in scores) / n,
            "hit@5": sum(s["hit@5"] for s in scores) / n,
            "avg_words_top3": round(sum(s["avg_words_top3"] for s in scores) / n),
        }
    return {"num_questions": len(per_question), "summary": summary, "per_question": per_question}


def print_report(report):
    """Print a per-question grid and a summary table."""
    summary = report["summary"]
    systems = list(summary)

    print("\nPer question (hit@5: Y = found the answer in the top 5)")
    print(f"{'question':28}" + "".join(f"{s:>11}" for s in systems))
    for row in report["per_question"]:
        cells = "".join(f"{'Y' if row['systems'][s]['hit@5'] else '.':>11}" for s in systems)
        print(f"{row['id']:28}{cells}")

    print(f"\nSummary over {report['num_questions']} questions")
    print(f"{'system':12}{'hit@3':>8}{'hit@5':>8}{'avg words (top 3)':>20}")
    for system in systems:
        s = summary[system]
        print(f"{system:12}{s['hit@3']:>8.0%}{s['hit@5']:>8.0%}{s['avg_words_top3']:>20,}")

    # Plain-English verdict.
    engines = [s for s in systems if s != CONSENSUS]
    best = max(engines, key=lambda e: (summary[e]["hit@5"], summary[e]["hit@3"]))
    c, b = summary[CONSENSUS], summary[best]
    print(f"\nBest single engine: {best} (hit@3 {b['hit@3']:.0%}, hit@5 {b['hit@5']:.0%})")
    if (c["hit@5"], c["hit@3"]) > (b["hit@5"], b["hit@3"]):
        print("Consensus BEATS the best single engine.")
    elif (c["hit@5"], c["hit@3"]) == (b["hit@5"], b["hit@3"]):
        print("Consensus TIES the best single engine.")
    else:
        print("Consensus does NOT beat the best single engine.")


if __name__ == "__main__":
    report = evaluate(load_questions())
    print_report(report)
    RESULTS_FILE.write_text(json.dumps(report, indent=1))
    print(f"\nSaved {RESULTS_FILE.relative_to(ROOT)}")
