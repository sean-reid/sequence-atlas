# Changelog

## [0.3.0](https://github.com/sean-reid/sequence-atlas/compare/sequence-atlas-v0.2.0...sequence-atlas-v0.3.0) (2026-10-25)


### Features

* **tools:** name islands by kind, best-known member, shared phrase, or structure ([#50](https://github.com/sean-reid/sequence-atlas/issues/50)) ([0e8531d](https://github.com/sean-reid/sequence-atlas/commit/0e8531dcc5c1a7e92049438d9a021d6176dd65ec))

## [0.2.0](https://github.com/sean-reid/sequence-atlas/compare/sequence-atlas-v0.1.0...sequence-atlas-v0.2.0) (2026-10-25)


### Features

* **tools:** split layout.py, publish labels, place inside the voted island, tame hubs, test the math ([#43](https://github.com/sean-reid/sequence-atlas/issues/43)) ([3b69ef5](https://github.com/sean-reid/sequence-atlas/commit/3b69ef525e7b612b5f7f7377ad4bbf389860753e))
* **tools:** weight the combined map growth 35, recurrence 25, arithmetic 15, references 25 ([#48](https://github.com/sean-reid/sequence-atlas/issues/48)) ([e787134](https://github.com/sean-reid/sequence-atlas/commit/e787134c5f7112d062591369a50a17f747031aa3))
* **worker:** one cloudflare client, gzip on the wire, key allowlist, search bounds, pinned actions, dev data, worker tests ([#46](https://github.com/sean-reid/sequence-atlas/issues/46)) ([465295b](https://github.com/sean-reid/sequence-atlas/commit/465295b9a0bb5acc55184baa8443ba3f7ea03967))


### Bug Fixes

* **style:** re-step the ramps and darken the light categorical set for contrast ([#47](https://github.com/sean-reid/sequence-atlas/issues/47)) ([6dc9dd5](https://github.com/sean-reid/sequence-atlas/commit/6dc9dd51126038bae65b65714ce39b49b30c308c))
* **worker:** keep gzipped objects out of the edge cache ([#49](https://github.com/sean-reid/sequence-atlas/issues/49)) ([b471101](https://github.com/sean-reid/sequence-atlas/commit/b471101861e5a15f574ce08d02e39bcadb3a1572))

## 0.1.0 (2026-10-16)


### Features

* colour points by growth class, recurrence order, or keyword ([#7](https://github.com/sean-reid/sequence-atlas/issues/7)) ([de1dc20](https://github.com/sean-reid/sequence-atlas/commit/de1dc20e9a5b51a5c2f4b3c562a9a469bbbce127))
* map screen with picking, deep links, and the sequence panel ([#4](https://github.com/sean-reid/sequence-atlas/issues/4)) ([2573e8a](https://github.com/sean-reid/sequence-atlas/commit/2573e8a932248531df1696a4f9a73d3ce4db213c))
* opengraph card of the combined map ([#10](https://github.com/sean-reid/sequence-atlas/issues/10)) ([1bcf8b2](https://github.com/sean-reid/sequence-atlas/commit/1bcf8b2c13b83b77ea76751dadbf3b36d7b9f821))
* search names, terms, and a-numbers through d1 ([#6](https://github.com/sean-reid/sequence-atlas/issues/6)) ([d953176](https://github.com/sean-reid/sequence-atlas/commit/d9531764bdf72bb4115031b1d7c4ad3fdb2c2db1))
* shell worker, page, and build scripts ([43ca515](https://github.com/sean-reid/sequence-atlas/commit/43ca515d864bb7f36d3755283800b1229b7ab09e))
* **tools:** feature extraction and layout pipeline over the oeis dumps ([#3](https://github.com/sean-reid/sequence-atlas/issues/3)) ([fc8ac0d](https://github.com/sean-reid/sequence-atlas/commit/fc8ac0ddc96d4732bd6ad13b82ae9fb3451c71af))
* **tools:** shard step, colour codes, cluster size cap, and label bigrams ([#5](https://github.com/sean-reid/sequence-atlas/issues/5)) ([c8285f1](https://github.com/sean-reid/sequence-atlas/commit/c8285f1f3b8eab64d606d5cff7af9517a1e1b4f6))
* weekly refresh with packed shards, incremental placement, and a standby search reload ([#9](https://github.com/sean-reid/sequence-atlas/issues/9)) ([c329c77](https://github.com/sean-reid/sequence-atlas/commit/c329c778479467d7267a18f7694236f56a40cefc))


### Bug Fixes

* allow the cloudflare web analytics beacon in the csp ([#13](https://github.com/sean-reid/sequence-atlas/issues/13)) ([789d49f](https://github.com/sean-reid/sequence-atlas/commit/789d49ffa20e6f8cb8535a78bdb6574f8461f5ef))
* audit quick wins across mobile layout, contrast, worker hardening, and placement ([#34](https://github.com/sean-reid/sequence-atlas/issues/34)) ([b3f954f](https://github.com/sean-reid/sequence-atlas/commit/b3f954fd7fb079c9b4505d88eb2d02a2eb7b7ec4))
* key data urls by a build digest of the uploaded artifacts ([#14](https://github.com/sean-reid/sequence-atlas/issues/14)) ([add2996](https://github.com/sean-reid/sequence-atlas/commit/add2996d900a002400cf4a8ae9f89768446cc58b))
* labels ride along with a drag and settle when it ends ([#36](https://github.com/sean-reid/sequence-atlas/issues/36)) ([4b4c40d](https://github.com/sean-reid/sequence-atlas/commit/4b4c40d3127b4640149ee58087be66d334676b66))
* read sequences from the oeisdata checkout in the refresh ([#12](https://github.com/sean-reid/sequence-atlas/issues/12)) ([e874fb2](https://github.com/sean-reid/sequence-atlas/commit/e874fb2de0cedfa2fbe0a89ae7f8fc55d752d1b9))
* segmented colour control, stylesheet wait before first draw, fallback when codes are missing ([#8](https://github.com/sean-reid/sequence-atlas/issues/8)) ([385a743](https://github.com/sean-reid/sequence-atlas/commit/385a743e1e7de9387bb7fa11bfd749b806856115))
