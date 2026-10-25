# sequence atlas

A map of the OEIS at [sequence-atlas.dwainosaur.com](https://sequence-atlas.dwainosaur.com). Every sequence that is not marked dead and has at least ten terms is one point, laid out so that sequences which are alike under one of five measures sit near each other: growth, arithmetic structure, linear recurrence, cross references, or all of them together. Pick a point, or search by A-number, name, or a run of terms, to see the sequence, the island it sits in, and its twenty nearest neighbors with the features that put them close. Points can be colored by island, growth class, recurrence order, or keyword.

## Development

Node 24, Rust stable, and uv.

```sh
npm install
npm run build          # bundle the client into dist/
npm run fixture        # 600 synthetic sequences into dist/data and the local search database
npm run dev:data       # or seed wrangler's local R2 state from ~/.cache/sequence-atlas/spike-fast (or a directory you name)
npm run dev            # wrangler dev on http://localhost:8787
npm test               # unit tests
npm run test:e2e       # Playwright over the fixture; run npx playwright install chromium once
```

## How it runs

One Cloudflare Worker serves the page, answers `/api/search` from a D1 database with FTS5 indexes over names and terms, and serves `/data/*` from an R2 bucket: a manifest naming the current version, then per-family layouts, cluster ids and labels, color codes, and per-sequence shards read by byte range out of one pack per kind. Data URLs carry the manifest's build digest, so a republished file is a new URL.

The artifacts come from the tools: `atlas features <oeisdata-checkout> <out>` (Rust, 17 s for all of OEIS), then in `tools/layout` `uv run layout.py embed <features> <out>` for the UMAP layouts, clusters, and labels of every family, and `uv run layout.py shards <features> <out> --snapshot <date>` for the packs. `node scripts/r2-sync.ts <out> v/<generation>` uploads what changed, `node scripts/search-sql.ts <features>/meta.tsv <sql>` and `node scripts/d1-refresh.ts <sql>` load the standby search database and flip the pointer, and `node scripts/r2-manifest.ts <out> v/<generation>` publishes the manifest. The scripts read `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

The combined map weights the four families by share of variance: growth 35, recurrence 25, arithmetic 15, cross references 25, recorded under `params.combined_weights` in the manifest and overridable with `layout.py embed --weights growth=0.35,recur=0.25,arith=0.15,graph=0.25`. The values came from scoring 29 weightings on a 15,000-sequence sample against two things the features never see: how many of a sequence's held-out cross references land in its twenty nearest neighbors, and how alike the neighbors' names are. More arithmetic weight lowered both scores, because its residue columns repeat each other, and less reference weight did too. The best weighting on both was growth 35, recurrence 15, arithmetic 15, references 35; the shipped one gives up about 1.5 percent of that to keep the combined map from doubling the references map.

`.github/workflows/refresh.yml` runs that chain every Monday with `layout.py place` in place of `embed`, which keeps the layouts frozen and puts the week's new sequences at the mean of their nearest neighbors in feature space. Every run writes a new dated prefix and the manifest switches to it last. A full re-embed is a manual run of `embed` and `shards`, then the same sync and publish steps.
