# searchHack
Improving AI-powered search under the hood.

Ask a question and get an answer where every sentence is checked against the source it cites.

1. **Search:** Tavily fetches web sources (`lib/tavily.ts`).
2. **Answer:** Claude Sonnet 5.5 writes the answer as one-fact claims, each citing source numbers (`lib/pipeline.ts`).
3. **Verify:** Claude Haiku 5.5 checks each claim in parallel against only its cited sources and marks it supported (green), partial (amber), or unsupported (red).

## Run locally

Create `.env.local` in the project root:

```
TAVILY_API_KEY=...
ANTHROPIC_API_KEY=...
```

Then:

```bash
npm install
npm run dev
```

Open http://localhost:3000.
