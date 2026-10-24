"""Turn the atlas feature matrix into layouts, clusters, labels, and neighbors.

usage:
  uv run layout.py embed <features-dir> <out-dir> [--families a,b,c] [--sample N] [--epochs N]
  uv run layout.py shards <features-dir> <out-dir> --snapshot <date>
  uv run layout.py place <features-dir> <prev-out-dir> <out-dir> --snapshot <date>

embed runs per family and caches the neighbor graph and embedding as .npz and
.npy under the out dir, so clustering and labeling can be rerun without
repeating UMAP. shards reads every family's neighbor graph from the out dir
and writes the per-sequence files the site fetches, with manifest.json
recording the count, the families, and the oeisdata commit date given as --snapshot.
place is the weekly refresh: sequences missing from the previous out dir are
put into its layouts next to their nearest old neighbors in feature space,
then shards runs over everything.
"""

import argparse
import json
import time
from pathlib import Path

import numpy as np

from atlas import log
from atlas.codes import GROWTH_CLASSES, KEYWORD_LABELS, LABELS, color_codes, histogram
from atlas.embed import PARAMS, cluster, embed, explain, knn_graph, label_clusters
from atlas.features import FAMILIES, family_matrix, feature_names, graph_features, load, needs_graph, standardize, take
from atlas.format import (
    FORMAT,
    NEIGHBORS,
    NOISE,
    read_layout,
    shard_groups,
    shard_key,
    write_layout,
    write_manifest,
    write_shard_pack,
)


def run_embed(features_dir, out, families, sample, epochs):
    t0 = time.time()
    data = load(features_dir)
    if sample and sample < len(data.numbers):
        rng = np.random.default_rng(PARAMS["sample_seed"])
        data = take(data, np.sort(rng.choice(len(data.numbers), sample, replace=False)))
    X, cols, numbers, names, keywords = data.X, data.cols, data.numbers, data.names, data.keywords
    log(f"loaded {X.shape[0]} sequences, {X.shape[1]} features")
    numbers.tofile(out / "numbers.u32")
    graph = graph_features(numbers, keywords, data.xrefs) if needs_graph(families) else None

    report = {"count": len(numbers), "params": PARAMS, "families": {}}
    probes = [45, 40, 290, 108, 5132, 2, 796, 10, 142, 1006]
    index = {int(n): i for i, n in enumerate(numbers)}
    for family in families:
        log(f"== {family}")
        M = family_matrix(family, X, cols, graph)
        knn = knn_graph(M, out / f"{family}.knn.npz")
        Y = embed(M, knn, out / f"{family}.embedding.npy", epochs)
        labels = cluster(Y)
        label_text = label_clusters(labels, names, keywords)
        write_layout(out / f"{family}.layout.bin", Y)
        np.where(labels < 0, NOISE, labels).astype(np.uint16).tofile(out / f"{family}.cluster.u16")
        clusters = []
        for c, toks in label_text.items():
            m = labels == c
            clusters.append(
                {
                    "id": int(c),
                    "label": " ".join(toks),
                    "size": int(m.sum()),
                    "cx": float(Y[m, 0].mean()),
                    "cy": float(Y[m, 1].mean()),
                }
            )
        clusters.sort(key=lambda c: -c["size"])
        (out / f"{family}.clusters.json").write_text(json.dumps(clusters))
        nn = knn[0][:, 1:]
        sample_nn = {}
        for p in probes:
            if p in index:
                sample_nn[shard_key(p)] = [f"{shard_key(int(numbers[j]))} {names[j][:60]}" for j in nn[index[p], :6]]
        report["families"][family] = {
            "dims": int(M.shape[1]),
            "clusters": len(clusters),
            "noise": float(np.mean(labels < 0)),
            "top_clusters": [f"{c['size']}: {c['label']}" for c in clusters[:25]],
            "neighbors": sample_nn,
        }
    report["seconds"] = round(time.time() - t0)
    (out / f"report-{'-'.join(families)}.json").write_text(json.dumps(report, indent=1))
    log(f"done in {report['seconds']}s")


def load_for(features_dir, out):
    """The data in the order of the out dir's numbers.u32, with the graph features when a family needs them."""
    numbers = np.fromfile(out / "numbers.u32", dtype=np.uint32)
    data = load(features_dir)
    index = {int(n): i for i, n in enumerate(data.numbers)}
    data = take(data, [index[int(n)] for n in numbers])
    families = [f for f in FAMILIES if (out / f"{f}.knn.npz").exists()]
    graph = graph_features(numbers, data.keywords, data.xrefs) if needs_graph(families) else None
    return data, numbers, graph


def neighbor_entry(numbers, nn, why):
    def near(i):
        return [[int(numbers[j]), int(a), int(b)] for j, (a, b) in zip(nn[i], why[i], strict=True)]

    return near


def run_shards(out, snapshot, data, numbers, graph):
    t0 = time.time()
    families = [f for f in FAMILIES if (out / f"{f}.knn.npz").exists()]
    log(f"{len(numbers)} sequences, families {', '.join(families)}")
    clusters = {}
    for f in families:
        path = out / f"{f}.cluster.u16"
        if path.exists():
            clusters[f] = np.fromfile(path, dtype=np.uint16)
    features = feature_names(families, data.cols)
    features["labels"] = LABELS
    features["format"] = FORMAT
    (out / "features.json").write_text(json.dumps(features))
    color = color_codes(data.X, data.cols, data.keywords)
    color.tofile(out / "color.u8")
    histogram("growth class", color[:, 0], GROWTH_CLASSES)
    histogram("recurrence order", color[:, 1])
    histogram("keyword group", color[:, 2], KEYWORD_LABELS)
    groups = shard_groups(numbers)

    def base(i):
        return {
            "name": data.names[i],
            "terms": data.terms[i],
            "offset": data.offsets[i],
            "keywords": data.keywords[i],
            "cluster": {f: None if c[i] == NOISE else int(c[i]) for f, c in clusters.items()},
            "color": color[i].tolist(),
        }

    raw, packed = write_shard_pack(out / "shards" / "base.pack", numbers, groups, base)
    log(f"shards/base.pack: {len(groups)} shards, {raw:.1f} KB raw, {packed:.1f} KB gzipped each")
    for f in families:
        M = family_matrix(f, data.X, data.cols, graph)
        nn = np.load(out / f"{f}.knn.npz")["idx"][:, 1 : NEIGHBORS + 1]
        # explain() assumes centered columns; the graph family's keyword flags
        # and degree are not, so score on a standardized copy.
        why = explain(standardize(M), nn)
        raw, packed = write_shard_pack(out / "shards" / f"{f}.pack", numbers, groups, neighbor_entry(numbers, nn, why))
        log(f"shards/{f}.pack: {len(groups)} shards, {raw:.1f} KB raw, {packed:.1f} KB gzipped each")
    log(f"manifest: {write_manifest(out / 'manifest.json', len(numbers), families, snapshot, PARAMS)}")
    log(f"done in {time.time() - t0:.0f}s")


def place_new(M, old_rows, new_rows, positions, clusters):
    """Position and cluster for each new row from its nearest old rows in
    feature space. The cluster is the commonest among the neighbors that have
    one and the position is that of the nearest neighbor inside it, so the
    point lands on the island its label names. When every neighbor is noise
    the row is noise too, at the distance-weighted mean of their positions."""
    old = M[old_rows].astype(np.float32)
    old_sq = np.einsum("ij,ij->i", old, old)
    pos = np.zeros((len(new_rows), 2), dtype=np.float32)
    lab = np.full(len(new_rows), NOISE, dtype=np.uint16)
    step = PARAMS["place_chunk"]
    for start in range(0, len(new_rows), step):
        chunk = M[new_rows[start : start + step]].astype(np.float32)
        d2 = old_sq[None, :] - 2 * chunk @ old.T + np.einsum("ij,ij->i", chunk, chunk)[:, None]
        k = min(PARAMS["place_k"], len(old_rows))
        near = np.argpartition(d2, k - 1, axis=1)[:, :k]
        for r in range(len(chunk)):
            idx = near[r]
            dist = np.sqrt(np.maximum(d2[r, idx], 0))
            votes = clusters[idx]
            real = votes[votes != NOISE]
            if len(real):
                lab[start + r] = np.bincount(real).argmax()
                inside = np.flatnonzero(votes == lab[start + r])
                pos[start + r] = positions[idx[inside[dist[inside].argmin()]]]
            else:
                w = 1.0 / (dist + PARAMS["place_epsilon"])
                pos[start + r] = (positions[idx] * w[:, None]).sum(axis=0) / w.sum()
    return pos, lab


def run_place(features_dir, prev, out, snapshot):
    """Add the sequences oeisdata gained since the last run to frozen layouts,
    then rebuild neighbors and shards for everything."""
    t0 = time.time()
    data = load(features_dir)
    prev_numbers = np.fromfile(prev / "numbers.u32", dtype=np.uint32)
    families = [f for f in FAMILIES if (prev / f"{f}.layout.bin").exists()]
    current = {int(n): i for i, n in enumerate(data.numbers)}
    kept = [int(n) for n in prev_numbers if int(n) in current]
    known = set(kept)
    added = sorted(int(n) for n in data.numbers if int(n) not in known)
    log(f"{len(kept)} kept, {len(prev_numbers) - len(kept)} gone, {len(added)} new")
    if not kept:
        raise SystemExit("the previous artifacts share no sequence with the current dumps; refusing to place")
    # The client binary-searches numbers.u32, so the final order is ascending;
    # old rows are gathered through prev_rows and new rows through new_rows.
    numbers = np.array(sorted(kept + added), dtype=np.uint32)
    data = take(data, [current[int(n)] for n in numbers])
    added_set = set(added)
    new_rows = np.array([i for i, n in enumerate(numbers) if int(n) in added_set], dtype=np.int64)
    old_rows = np.array([i for i, n in enumerate(numbers) if int(n) not in added_set], dtype=np.int64)
    prev_index = {int(n): i for i, n in enumerate(prev_numbers)}
    prev_rows = np.array([prev_index[int(numbers[i])] for i in old_rows], dtype=np.int64)
    graph = graph_features(numbers, data.keywords, data.xrefs) if needs_graph(families) else None
    numbers.tofile(out / "numbers.u32")
    for f in families:
        M = family_matrix(f, data.X, data.cols, graph)
        prev_positions, bounds = read_layout(prev / f"{f}.layout.bin")
        prev_clusters = np.fromfile(prev / f"{f}.cluster.u16", dtype=np.uint16)
        positions = np.zeros((len(numbers), 2), dtype=np.float32)
        clusters = np.full(len(numbers), NOISE, dtype=np.uint16)
        positions[old_rows] = prev_positions[prev_rows]
        clusters[old_rows] = prev_clusters[prev_rows]
        if len(new_rows):
            pos, lab = place_new(M, old_rows, new_rows, positions[old_rows], clusters[old_rows])
            positions[new_rows] = pos
            clusters[new_rows] = lab
        write_layout(out / f"{f}.layout.bin", positions, bounds)
        clusters.tofile(out / f"{f}.cluster.u16")
        info = json.loads((prev / f"{f}.clusters.json").read_text())
        sizes = np.bincount(clusters[clusters != NOISE], minlength=len(info))
        for c in info:
            c["size"] = int(sizes[c["id"]]) if c["id"] < len(sizes) else 0
        (out / f"{f}.clusters.json").write_text(json.dumps(info))
        cache = out / f"{f}.knn.npz"
        if cache.exists():
            cache.unlink()
        knn_graph(M, cache)
        log(f"{f}: {len(new_rows)} placed, {int((clusters[new_rows] == NOISE).sum()) if len(new_rows) else 0} as noise")
    log(f"placed in {time.time() - t0:.0f}s")
    run_shards(out, snapshot, data, numbers, graph)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    embed_cmd = commands.add_parser("embed", help="lay out every family and cache the neighbor graphs")
    embed_cmd.add_argument("features", type=Path)
    embed_cmd.add_argument("out", type=Path)
    embed_cmd.add_argument("--families", default=",".join(FAMILIES))
    embed_cmd.add_argument("--sample", type=int, default=0)
    embed_cmd.add_argument("--epochs", type=int, default=200)
    shards_cmd = commands.add_parser("shards", help="write the packs and manifest from cached neighbor graphs")
    shards_cmd.add_argument("features", type=Path)
    shards_cmd.add_argument("out", type=Path)
    shards_cmd.add_argument("--snapshot", required=True)
    place_cmd = commands.add_parser("place", help="add new sequences to frozen layouts, then write shards")
    place_cmd.add_argument("features", type=Path)
    place_cmd.add_argument("prev", type=Path)
    place_cmd.add_argument("out", type=Path)
    place_cmd.add_argument("--snapshot", required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    if args.command == "embed":
        run_embed(args.features, args.out, args.families.split(","), args.sample, args.epochs)
    elif args.command == "shards":
        data, numbers, graph = load_for(args.features, args.out)
        run_shards(args.out, args.snapshot, data, numbers, graph)
    else:
        run_place(args.features, args.prev, args.out, args.snapshot)


if __name__ == "__main__":
    main()
