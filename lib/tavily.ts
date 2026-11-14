import type { Source } from "./types";

type TavilyResult = { title: string; url: string; content: string };

export async function searchWeb(query: string, maxResults = 5): Promise<Source[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
    },
    body: JSON.stringify({
      query,
      max_results: maxResults,
      // "advanced" returns longer, more relevant snippets, which gives the
      // claim checker more text to work with. It costs more credits than "basic".
      search_depth: "advanced",
    }),
  });

  if (!res.ok) {
    throw new Error(`Tavily error ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as { results?: TavilyResult[] };
  return (data.results ?? []).map((r, i) => ({
    id: i + 1,
    title: r.title,
    url: r.url,
    content: r.content,
  }));
}
