"""Turn the atlas feature matrix into layouts, clusters, labels, and neighbours.

usage: uv run layout.py <features-dir> <out-dir> [--families a,b,c] [--sample N] [--epochs N]

Embeddings are cached as .npy under the out dir so clustering and labelling can
be rerun without repeating UMAP.
"""

import csv
import json
import re
import struct
import sys
import time
from collections import Counter
from pathlib import Path

import numpy as np
import scipy.sparse as sp
from scipy.sparse.linalg import LinearOperator, eigsh

FAMILIES = ["growth", "arith", "recur", "graph", "all"]
KEYWORDS = [
    "base", "bref", "cofr", "cons", "core", "dumb", "easy", "eigen", "fini", "frac",
    "full", "hard", "hear", "less", "look", "more", "mult", "nice", "nonn", "obsc",
    "sign", "tabf", "tabl", "walk", "word",
]
SPECTRAL_DIMS = 32
NEIGHBOURS = 20
UMAP_K = 15
KNN_K = NEIGHBOURS + 1
STOP = set("""
a an the of for and or with in to on by at is are as that which whose where from into
than not no if all one two such its this be when then also each any other over under
number numbers sequence sequences term terms integer integers n k m x y z read rows row
expansion coefficients coefficient function triangle array table partial sums sum
""".split())
TOKEN = re.compile(r"[a-z][a-z'-]{2,}")


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def load(features_dir, sample):
    cols = [tuple(line.rstrip("\n").split("\t")) for line in open(features_dir / "columns.tsv")]
    X = np.fromfile(features_dir / "features.f32", dtype=np.float32).reshape(-1, len(cols))
    meta = []
    with open(features_dir / "meta.tsv", newline="") as f:
        reader = csv.reader(f, delimiter="\t", quoting=csv.QUOTE_NONE)
        next(reader)
        for row in reader:
            meta.append(row)
    numbers = np.array([int(r[0]) for r in meta], dtype=np.uint32)
    names = [r[4] for r in meta]
    keywords = [r[3].split(",") if r[3] else [] for r in meta]
    assert len(numbers) == X.shape[0]
    xrefs = np.loadtxt(features_dir / "xrefs.tsv", dtype=np.uint32, delimiter="\t")
    if sample and sample < len(numbers):
        rng = np.random.default_rng(1)
        keep = np.sort(rng.choice(len(numbers), sample, replace=False))
        X = X[keep]
        numbers = numbers[keep]
        names = [names[i] for i in keep]
        keywords = [keywords[i] for i in keep]
    return X, cols, numbers, names, keywords, xrefs


def standardise(M):
    M = M.astype(np.float64)
    lo = np.percentile(M, 0.5, axis=0)
    hi = np.percentile(M, 99.5, axis=0)
    M = np.clip(M, lo, hi)
    mu = M.mean(axis=0)
    sd = M.std(axis=0)
    sd[sd < 1e-9] = 1.0
    return ((M - mu) / sd).astype(np.float32)


def graph_features(numbers, keywords, xrefs):
    index = {int(n): i for i, n in enumerate(numbers)}
    n = len(numbers)
    rows, cols_ = [], []
    for a, b in xrefs:
        i, j = index.get(int(a)), index.get(int(b))
        if i is None or j is None:
            continue
        rows.append(i)
        cols_.append(j)
    A = sp.coo_matrix((np.ones(len(rows), dtype=np.float32), (rows, cols_)), shape=(n, n))
    A = ((A + A.T) > 0).astype(np.float64).tocsr()
    deg = np.asarray(A.sum(axis=1)).ravel()
    log(f"xref graph: {n} nodes, {A.nnz // 2} edges, {np.sum(deg == 0)} isolated")
    # Regularised normalised adjacency (Amini et al.): every pair gains tau/n of
    # an edge, which joins the small components to the whole and stops the top
    # eigenvectors from being component indicators.
    tau = deg.mean()
    dinv = 1.0 / np.sqrt(deg + tau)

    def matvec(v):
        v = v.ravel()
        w = dinv * v
        return dinv * (A @ w + (tau / n) * w.sum())

    op = LinearOperator((n, n), matvec=matvec, dtype=np.float64)
    t = time.time()
    vals, vecs = eigsh(op, k=SPECTRAL_DIMS + 1, which="LA", tol=1e-4)
    order = np.argsort(-vals)
    vals, vecs = vals[order][1:], vecs[:, order][:, 1:]
    log(f"spectral embedding in {time.time() - t:.0f}s, eigenvalues {vals[0]:.3f}..{vals[-1]:.3f}")
    spec = vecs * np.sqrt(np.maximum(vals, 0))
    spec = spec / (spec.std(axis=0) + 1e-12)
    K = np.zeros((n, len(KEYWORDS)), dtype=np.float32)
    kwi = {k: i for i, k in enumerate(KEYWORDS)}
    for i, kws in enumerate(keywords):
        for k in kws:
            if k in kwi:
                K[i, kwi[k]] = 1.0
    return np.hstack([spec.astype(np.float32), K * 1.5, np.log1p(deg)[:, None].astype(np.float32)])


def family_matrix(family, X, cols, graph):
    if family == "graph":
        return graph
    if family == "all":
        parts = [standardise(X[:, [i for i, c in enumerate(cols) if c[0] == f]]) for f in ("growth", "arith", "recur")]
        parts.append(graph * 0.5)
        return np.hstack(parts)
    idx = [i for i, c in enumerate(cols) if c[0] == family]
    return standardise(X[:, idx])


def knn_graph(M, cache):
    """Approximate nearest neighbours in feature space, shared by UMAP and the neighbour lists."""
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
    reducer = umap.UMAP(
        n_neighbors=UMAP_K,
        min_dist=0.1,
        n_components=2,
        init="pca",
        n_epochs=epochs,
        precomputed_knn=(knn[0][:, :UMAP_K], knn[1][:, :UMAP_K]),
        low_memory=False,
        verbose=False,
    )
    Y = reducer.fit_transform(M).astype(np.float32)
    log(f"umap on {M.shape} in {time.time() - t:.0f}s ({epochs} epochs)")
    np.save(cache, Y)
    return Y


def cluster(Y):
    from sklearn.cluster import HDBSCAN

    t = time.time()
    size = max(50, len(Y) // 1500)
    labels = HDBSCAN(min_cluster_size=size, min_samples=10, cluster_selection_method="eom", n_jobs=-1, copy=True).fit_predict(Y)
    k = labels.max() + 1
    noise = np.mean(labels < 0)
    log(f"hdbscan: {k} clusters, {noise:.1%} noise, min size {size}, in {time.time() - t:.0f}s")
    return labels


def tokens_for(name, kws):
    toks = {t for t in TOKEN.findall(name.lower()) if t not in STOP}
    toks |= {f"kw:{k}" for k in kws if k not in ("nonn", "changed", "new", "easy", "sign")}
    return toks


def label_clusters(labels, names, keywords):
    docs = [tokens_for(n, k) for n, k in zip(names, keywords)]
    corpus = Counter()
    for d in docs:
        corpus.update(d)
    total = len(docs)
    out = {}
    for c in range(labels.max() + 1):
        members = np.flatnonzero(labels == c)
        counts = Counter()
        for i in members:
            counts.update(docs[i])
        n_in = len(members)
        scored = []
        for tok, c_in in counts.items():
            if c_in < max(5, n_in * 0.05):
                continue
            c_out = corpus[tok] - c_in
            n_out = total - n_in
            p_in = (c_in + 0.5) / (n_in + 1)
            p_out = (c_out + 0.5) / (n_out + 1)
            lift = np.log(p_in / p_out)
            scored.append((lift * np.sqrt(c_in / n_in), tok))
        scored.sort(reverse=True)
        out[c] = [t.removeprefix("kw:") for _, t in scored[:3]]
    return out


def write_layout(path, Y):
    lo = Y.min(axis=0)
    hi = Y.max(axis=0)
    q = np.round((Y - lo) / np.maximum(hi - lo, 1e-9) * 65535).astype(np.uint16)
    with open(path, "wb") as f:
        f.write(b"ATL1")
        f.write(struct.pack("<I", len(Y)))
        f.write(struct.pack("<4f", *lo, *hi))
        f.write(q.tobytes())
    return q


def main():
    args = sys.argv[1:]
    features_dir = Path(args[0])
    out = Path(args[1])
    out.mkdir(parents=True, exist_ok=True)
    families = FAMILIES
    sample = 0
    epochs = 200
    i = 2
    while i < len(args):
        if args[i] == "--families":
            families = args[i + 1].split(",")
            i += 2
        elif args[i] == "--sample":
            sample = int(args[i + 1])
            i += 2
        elif args[i] == "--epochs":
            epochs = int(args[i + 1])
            i += 2
        else:
            raise SystemExit(__doc__)

    t0 = time.time()
    X, cols, numbers, names, keywords, xrefs = load(features_dir, sample)
    log(f"loaded {X.shape[0]} sequences, {X.shape[1]} features")
    numbers.tofile(out / "numbers.u32")
    with open(out / "names.txt", "w") as f:
        f.write("\n".join(names))
    graph = graph_features(numbers, keywords, xrefs)

    report = {"count": int(len(numbers)), "families": {}}
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
        np.where(labels < 0, 65535, labels).astype(np.uint16).tofile(out / f"{family}.cluster.u16")
        clusters = []
        for c, toks in label_text.items():
            m = labels == c
            clusters.append({"id": int(c), "label": " ".join(toks), "size": int(m.sum()), "cx": float(Y[m, 0].mean()), "cy": float(Y[m, 1].mean())})
        clusters.sort(key=lambda c: -c["size"])
        json.dump(clusters, open(out / f"{family}.clusters.json", "w"))
        nn = knn[0][:, 1:].astype(np.uint32)
        nn.tofile(out / f"{family}.nn.u32")
        sample_nn = {}
        for p in probes:
            if p in index:
                sample_nn[f"A{p:06d}"] = [f"A{numbers[j]:06d} {names[j][:60]}" for j in nn[index[p], :6]]
        report["families"][family] = {
            "dims": int(M.shape[1]),
            "clusters": len(clusters),
            "noise": float(np.mean(labels < 0)),
            "top_clusters": [f"{c['size']}: {c['label']}" for c in clusters[:25]],
            "neighbours": sample_nn,
        }
    report["seconds"] = round(time.time() - t0)
    json.dump(report, open(out / f"report-{'-'.join(families)}.json", "w"), indent=1)
    log(f"done in {report['seconds']}s")


if __name__ == "__main__":
    main()
