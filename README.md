# sequence atlas

A map of the OEIS at [sequence-atlas.dwainosaur.com](https://sequence-atlas.dwainosaur.com). Every sequence with at least ten terms is one point, laid out so that sequences which are alike under one of five measures sit near each other: growth, arithmetic structure, linear recurrence, cross references, or all of them together. Switch the measure and the points move to their new places. Pick a point, or search by A-number, name, or a run of terms, to see the sequence, the island it sits in, and its twenty nearest neighbours with the features that put them close. Points can be coloured by island, growth class, recurrence order, or keyword.

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
