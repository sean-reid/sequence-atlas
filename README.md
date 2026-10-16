# sequence-atlas

A map of the OEIS. Every sequence with at least ten terms is one point, laid out so that sequences which are alike under one of several mathematical measures sit near each other. Switch the measure and the map rearranges. Pick a point to see the sequence, its nearest neighbours, and why they count as neighbours.

## Development

```sh
npm install
npm run build          # bundle the client into dist/
npm run dev            # wrangler dev on http://localhost:8787
npm test               # unit tests
npm run test:e2e       # Playwright against a built bundle
```

## How it runs

One Cloudflare Worker serves the static site and `/api/health`. Everything the map shows is computed ahead of time by the tools under `tools/` and uploaded as static files. The Rust tool extracts the features, then `tools/layout` runs in two steps: `uv run layout.py embed` once per family writes the layout, clusters, and neighbour graph, and `uv run layout.py shards` once writes the per-sequence files the site fetches.
