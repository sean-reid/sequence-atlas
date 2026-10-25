"""Neighbor graphs, UMAP, HDBSCAN, cluster labels, and the columns that explain a neighbor."""

import itertools
import re
import time
from collections import Counter

import numpy as np

from atlas import log
from atlas.format import NEIGHBORS

# Every tunable without a name of its own, written into each report and manifest.
PARAMS = {
    "sample_seed": 1,
    "umap_neighbors": 15,
    "umap_min_dist": 0.1,
    "cluster_sample": 120_000,
    "cluster_seed": 7,
    "min_cluster_floor": 50,
    "min_cluster_divisor": 1500,
    "min_samples": 10,
    "max_cluster_fraction": 0.05,
    "assign_k": 7,
    "label_min_count": 5,
    "label_min_share": 0.05,
    "label_smoothing": 0.5,
    "explain_chunk": 20_000,
    "explain_gap_weight": 2.0,
    "place_chunk": 256,
    "place_epsilon": 1e-6,
    "place_k": 15,
    "eigsh_tol": 1e-4,
    "keyword_weight": 1.5,
    "clip_percentile": 0.5,
    "combined_weights": {"growth": 0.35, "recur": 0.25, "arith": 0.15, "graph": 0.25},
    "combined_drop_moduli": [4, 6, 10],
}
KNN_K = NEIGHBORS + 1
LABEL_WORDS = 3
TOKEN = re.compile(r"[a-z][a-z'-]{2,}")
STOP_WORDS = """
a an the of for and or with in to on by at is are as that which whose where from into
than not no if all one two such its this be when then also each any other over under
number numbers sequence sequences term terms integer integers n k m x y z read rows row
expansion coefficients coefficient function triangle array table partial sums sum
satisfies exists form smallest least only more look taken consisting having gives given
equal equals exactly first using whose into such
"""
STOP = frozenset(STOP_WORDS.split())


def knn_graph(M, cache):
    """Approximate nearest neighbors in feature space, shared by UMAP and the neighbor lists."""
    if cache.exists():
        d = np.load(cache)
        return d["idx"], d["dist"]
    from pynndescent import NNDescent

    t = time.time()
    index = NNDescent(M, n_neighbors=KNN_K, metric="euclidean", n_jobs=-1, verbose=False)
    idx, dist = index.neighbor_graph
    log(f"knn on {M.shape} in {time.time() - t:.0f}s")
    np.savez(cache, idx=idx, dist=dist)
    return idx, dist


def embed(M, knn, cache, epochs):
    if cache.exists():
        return np.load(cache)
    import umap

    t = time.time()
    k = PARAMS["umap_neighbors"]
    reducer = umap.UMAP(
        n_neighbors=k,
        min_dist=PARAMS["umap_min_dist"],
        n_components=2,
        init="pca",
        n_epochs=epochs,
        precomputed_knn=(knn[0][:, :k], knn[1][:, :k]),
        low_memory=False,
        verbose=False,
    )
    Y = reducer.fit_transform(M).astype(np.float32)
    log(f"umap on {M.shape} in {time.time() - t:.0f}s ({epochs} epochs)")
    np.save(cache, Y)
    return Y


def cluster(Y):
    """HDBSCAN on a subsample of the layout, the rest assigned to the nearest
    labeled points. Density clusters in two dimensions barely change past
    this sample size and the full run takes many times longer."""
    from sklearn.cluster import HDBSCAN
    from sklearn.neighbors import KNeighborsClassifier

    t = time.time()
    n = len(Y)
    rng = np.random.default_rng(PARAMS["cluster_seed"])
    pick = np.sort(rng.choice(n, min(n, PARAMS["cluster_sample"]), replace=False))
    size = max(PARAMS["min_cluster_floor"], len(pick) // PARAMS["min_cluster_divisor"])
    cap = int(len(pick) * PARAMS["max_cluster_fraction"])
    sub = HDBSCAN(
        min_cluster_size=size,
        min_samples=PARAMS["min_samples"],
        max_cluster_size=cap,
        cluster_selection_method="eom",
        n_jobs=-1,
        copy=True,
    ).fit_predict(Y[pick])
    labels = np.full(n, -1, dtype=np.int64)
    labels[pick] = sub
    rest = np.setdiff1d(np.arange(n), pick)
    if len(rest):
        labels[rest] = KNeighborsClassifier(n_neighbors=PARAMS["assign_k"]).fit(Y[pick], sub).predict(Y[rest])
    k = labels.max() + 1
    noise = np.mean(labels < 0)
    largest = np.bincount(labels[labels >= 0]).max() if k else 0
    log(
        f"hdbscan: {k} clusters, {noise:.1%} noise, largest {largest}, min size {size}, cap {cap}, sample {len(pick)}, in {time.time() - t:.0f}s"
    )
    return labels


def tokens_for(name, kws):
    words = TOKEN.findall(name.lower())
    toks = {t for t in words if t not in STOP}
    toks |= {f"{a} {b}" for a, b in itertools.pairwise(words) if a not in STOP and b not in STOP}
    toks |= {f"kw:{k}" for k in kws if k not in ("nonn", "changed", "new", "easy", "sign")}
    return toks


def pick_label(scored):
    """Highest scoring tokens up to LABEL_WORDS words. A bigram is eligible when
    it scores at least the best single token; ties go to the bigram, then to
    the alphabetically first text, so the label does not depend on set order."""
    best_single = max((s for s, t in scored if " " not in t), default=-np.inf)
    scored = sorted(scored, key=lambda st: (-st[0], " " not in st[1], st[1]))
    words, out = set(), []
    for score, tok in scored:
        parts = tok.split()
        if len(parts) > 1 and score < best_single:
            continue
        if words & set(parts) or len(words) + len(parts) > LABEL_WORDS:
            continue
        out.append(tok)
        words |= set(parts)
        if len(words) == LABEL_WORDS:
            break
    return out


def label_clusters(labels, names, keywords):
    docs = [tokens_for(n, k) for n, k in zip(names, keywords, strict=True)]
    corpus = Counter()
    for d in docs:
        corpus.update(d)
    total = len(docs)
    smooth = PARAMS["label_smoothing"]
    out = {}
    for c in range(labels.max() + 1):
        members = np.flatnonzero(labels == c)
        counts = Counter()
        for i in members:
            counts.update(docs[i])
        n_in = len(members)
        scored = []
        for tok, c_in in counts.items():
            if c_in < max(PARAMS["label_min_count"], n_in * PARAMS["label_min_share"]):
                continue
            c_out = corpus[tok] - c_in
            n_out = total - n_in
            p_in = (c_in + smooth) / (n_in + 1)
            p_out = (c_out + smooth) / (n_out + 1)
            lift = np.log(p_in / p_out)
            scored.append((lift * np.sqrt(c_in / n_in), tok))
        out[c] = [t.removeprefix("kw:") for t in pick_label(scored)]
    return out


def explain(Z, nn, limit=2):
    """For each neighbor, the columns where both points are alike and both sit
    away from the corpus mean: high shared magnitude, low difference."""
    out = np.zeros((nn.shape[0], nn.shape[1], limit), dtype=np.uint8)
    chunk = PARAMS["explain_chunk"]
    for start in range(0, len(Z), chunk):
        zi = Z[start : start + chunk]
        zj = Z[nn[start : start + chunk]]
        shared = np.abs(zi[:, None, :] + zj) / 2
        gap = np.abs(zi[:, None, :] - zj)
        score = shared - PARAMS["explain_gap_weight"] * gap
        out[start : start + chunk] = np.argsort(-score, axis=2)[:, :, :limit]
    return out
