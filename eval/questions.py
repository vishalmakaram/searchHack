"""Load and check the eval questions in questions.json.

Each question looks like:
    {
      "id": "pp-min-age",                  # short unique name
      "question": "What is the minimum ...",  # what we send to the search engines
      "answer_terms": ["17 years"],        # ALL of these must appear in a correct page
      "note": "unverified - check ..."     # where to verify the answer
    }
"""

import json
from pathlib import Path

QUESTIONS_FILE = Path(__file__).resolve().parent / "questions.json"
REQUIRED_KEYS = ["id", "question", "answer_terms", "note"]


def load_questions(path=QUESTIONS_FILE):
    """Read the questions file and stop with a clear message if one is broken."""
    questions = json.loads(Path(path).read_text())
    seen_ids = set()
    for number, q in enumerate(questions, start=1):
        for key in REQUIRED_KEYS:
            if key not in q:
                raise ValueError(f"Question #{number} is missing '{key}'")
        if not q["answer_terms"] or not all(isinstance(t, str) and t.strip() for t in q["answer_terms"]):
            raise ValueError(f"Question '{q['id']}' needs at least one non-empty answer term")
        if q["id"] in seen_ids:
            raise ValueError(f"Two questions share the id '{q['id']}'")
        seen_ids.add(q["id"])
    return questions


if __name__ == "__main__":
    # Run `python eval/questions.py` to check the file.
    questions = load_questions()
    unverified = sum("unverified" in q["note"].lower() for q in questions)
    print(f"{len(questions)} questions loaded, {unverified} still unverified")
    for q in questions:
        print(f"  {q['id']:26} terms={q['answer_terms']}")
