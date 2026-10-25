"""Neighbor graphs, UMAP, HDBSCAN, and the columns that explain a neighbor."""

import math
import time

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
    "name_kind_share": 0.5,
    "name_kind_strong": 0.8,
    "name_phrase_lift": math.log(3),
    "name_structure_share": 0.5,
    "name_phrase_share": 0.25,
    "name_exemplar_refs": 100,
    "name_exemplar_ratio": 20,
    "name_exemplar_cohesion": 0.7,
    "name_mainland_share": 0.02,
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
