# searchHack
Improving AI-powered search under the hood.

**Consensus search:** ask several search engines at once through [Telem](https://telem.ai), merge their rankings with reciprocal rank fusion so pages that several engines agree on rise to the top, and measure with a test set whether that beats any single engine.

| File | What it does |
|---|---|
| `consensus/engines.py` | `search_all(question)`: one Telem call to exa, tavily and brave (full page content on); raw responses cached in `cache/` |
| `consensus/fuse.py` | Reciprocal rank fusion: score = sum of 1 / (60 + rank); URLs normalized before matching |
| `eval/questions.json` | Test questions with `answer_terms` that must appear in a correct page (FAA starters, unverified) |
| `eval/run_eval.py` | hit@3, hit@5 and top-3 word count for each engine and for consensus; saves `eval/results.json` |
| `app.py` | Streamlit demo: each engine's top 5 side by side, then the consensus top 5 with agreement tags |

The earlier Next.js prototype lives in `legacy-nextjs/`.

## Setup (Python 3.12+)

```bash
uv venv --python 3.12 .venv        # or: python3.12 -m venv .venv
uv pip install --python .venv/bin/python -r requirements.txt
echo "TELEM_API_KEY=..." > .env     # never commit this file
```

## Run

```bash
.venv/bin/python eval/questions.py   # check the question file
.venv/bin/python eval/run_eval.py    # run the eval
.venv/bin/streamlit run app.py       # open the demo
```
