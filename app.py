"""Consensus Search: a simple page to show the idea to a judge.

Run it with:
    .venv/bin/streamlit run app.py
"""

from urllib.parse import urlsplit

import streamlit as st

from consensus.engines import PROVIDERS, search_all
from consensus.fuse import fuse

# One color per engine, so the tags are easy to match with the columns.
ENGINE_COLORS = {"exa": "violet", "tavily": "blue", "brave": "orange"}
TOP_N = 5


@st.cache_data(show_spinner=False)
def run_search(question):
    """Search every engine, then fuse. Cached so reruns of the page are instant."""
    by_engine = search_all(question)
    return by_engine, fuse(by_engine)


def domain(url):
    """Show 'faa.gov' instead of a long URL."""
    host = urlsplit(url).netloc.lower()
    return host[4:] if host.startswith("www.") else host


def link(result):
    """A Markdown link with the title (brackets removed so the link doesn't break)."""
    title = result["title"].replace("[", "(").replace("]", ")")
    return f"[{title}]({result['url']})"


def tag(engine):
    color = ENGINE_COLORS.get(engine, "gray")
    return f":{color}-badge[{engine}]"


st.set_page_config(page_title="Consensus Search", layout="wide")
st.title("Consensus Search")
st.write(
    "We ask several search engines the same question at the same time. "
    "Pages that **more than one engine agrees on** rise to the top."
)

with st.form("search"):
    question = st.text_input("Your question", placeholder="e.g. What is the maximum altitude for a drone under FAA Part 107?")
    submitted = st.form_submit_button("Search", type="primary")

if submitted and question.strip():
    try:
        with st.spinner("Asking every engine..."):
            by_engine, consensus = run_search(question.strip())
    except Exception as error:  # show the problem on the page instead of crashing
        st.error(f"Search failed: {error}")
        st.stop()

    # 1. Each engine on its own, side by side.
    st.subheader("What each engine found on its own")
    columns = st.columns(len(PROVIDERS))
    for column, engine in zip(columns, PROVIDERS):
        with column:
            st.markdown(f"#### {tag(engine)}")
            results = by_engine.get(engine, [])
            if not results:
                st.info("No results from this engine.")
            for number, result in enumerate(results[:TOP_N], start=1):
                st.markdown(f"{number}. {link(result)}  \n:gray[{domain(result['url'])}]")

    # 2. Then the merged list: pages several engines agree on come first.
    st.subheader("Consensus top 5")
    st.caption("Tags show which engines returned the same page.")
    for number, item in enumerate(consensus[:TOP_N], start=1):
        agreed = len(item["engines"])
        with st.container(border=True):
            st.markdown(f"**{number}. {link(item)}**  \n{domain(item['url'])}")
            tags = " ".join(tag(e) for e in item["engines"])
            st.markdown(f"{tags} &nbsp; agreed by {agreed} of {len(PROVIDERS)} engines")
elif submitted:
    st.warning("Type a question first.")
