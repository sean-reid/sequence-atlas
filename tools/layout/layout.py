"""Turn the atlas feature matrix into layouts, clusters, labels, and neighbors.

usage:
  uv run layout.py embed <features-dir> <out-dir> [--families a,b,c] [--sample N] [--epochs N]
  uv run layout.py shards <features-dir> <out-dir> --snapshot <date>
  uv run layout.py place <features-dir> <prev-out-dir> <out-dir> --snapshot <date>

embed runs per family and caches the neighbor graph and embedding as .npz and
.npy under the out dir, so clustering and labelling can be rerun without
repeating UMAP. shards reads every family's neighbor graph from the out dir
and writes the per-sequence files the site fetches, with manifest.json
recording the count, the families, and the oeisdata commit date given as --snapshot.
place is the weekly refresh: sequences missing from the previous out dir are
put into its layouts at the distance-weighted mean of their nearest old
neighbors in feature space, then shards runs over everything.
"""

import csv
import gzip
import json
import re
import struct
import sys
import time
from collections import Counter
from pathlib import Path
from typing import NamedTuple

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
NEIGHBORS = 20
UMAP_K = 15
KNN_K = NEIGHBORS + 1
STOP = set("""
a an the of for and or with in to on by at is are as that which whose where from into
than not no if all one two such its this be when then also each any other over under
number numbers sequence sequences term terms integer integers n k m x y z read rows row
expansion coefficients coefficient function triangle array table partial sums sum
satisfies exists form smallest least only more look taken consisting having gives given
equal equals exactly first using whose into such
""".split())
LABEL_WORDS = 3
TOKEN = re.compile(r"[a-z][a-z'-]{2,}")


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


class Data(NamedTuple):
    X: np.ndarray
    cols: list
    numbers: np.ndarray
    names: list
    keywords: list
    terms: list
    offsets: list
    xrefs: np.ndarray


def load(features_dir):
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
    terms = [r[5] if len(r) > 5 else "" for r in meta]
    offsets = [int(r[2]) for r in meta]
    assert len(numbers) == X.shape[0]
    xrefs = np.loadtxt(features_dir / "xrefs.tsv", dtype=np.uint32, delimiter="\t")
    data = Data(X, cols, numbers, names, keywords, terms, offsets, xrefs)
    # Dead entries are errata and duplicates kept for the record, not sequences.
    alive = np.flatnonzero(["dead" not in k for k in keywords])
    log(f"dropping {len(numbers) - len(alive)} dead entries")
    return take(data, alive)


def take(data, keep):
    keep = np.asarray(keep)
    return data._replace(
        X=data.X[keep],
        numbers=data.numbers[keep],
        names=[data.names[i] for i in keep],
        keywords=[data.keywords[i] for i in keep],
        terms=[data.terms[i] for i in keep],
        offsets=[data.offsets[i] for i in keep],
    )


def standardize(M):
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
    # Regularised normalized adjacency (Amini et al.): every pair gains tau/n of
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


def needs_graph(families):
    return any(f in ("graph", "all") for f in families)


PHRASES = {
    "g_log_last": "last term size",
    "g_log_max": "largest term size",
    "g_poly_slope": "polynomial degree",
    "g_poly_resid": "polynomial fit error",
    "g_exp_slope": "exponential rate",
    "g_exp_resid": "exponential fit error",
    "g_fact_slope": "factorial rate",
    "g_fact_resid": "factorial fit error",
    "g_ratio_last": "last term ratio",
    "g_ratio_trend": "ratio trend",
    "g_frac_neg": "negative terms",
    "g_frac_zero": "zero terms",
    "g_sign_changes": "sign changes",
    "g_frac_nondecreasing": "nondecreasing steps",
    "g_frac_increasing": "increasing steps",
    "g_frac_one": "terms equal one",
    "g_frac_small": "single digit terms",
    "g_log_first": "first term size",
    "g_curvature": "growth curvature",
    "a_entropy_mod2": "parity balance",
    "a_top_share_mod2": "parity bias",
    "a_period_mod2": "parity period",
    "a_frac_prime": "prime terms",
    "a_frac_distinct": "distinct terms",
    "a_frac_square": "square terms",
    "a_frac_pow2": "powers of two",
    "a_gcd_log": "common divisor",
    "a_frac_even": "even terms",
    "a_parity_run": "longest parity run",
    "a_frac_adjacent_equal": "equal adjacent terms",
    "a_frac_coprime_adjacent": "coprime adjacent terms",
    "a_multiplicative": "multiplicativity",
    "a_digit_sum_mean": "mean digit sum",
    "r_order": "recurrence order",
    "r_found": "linear recurrence",
    "r_diff_degree": "difference degree",
    "r_poly": "polynomial",
    "r_diff_ratio": "difference size",
    "r_diff2_ratio": "second difference size",
    "r_period": "period",
    "r_periodic": "periodic",
    "r_eventually_constant": "eventually constant",
    "degree": "number of cross references",
}


def feature_names(families, cols):
    return {f: [{"name": c, "phrase": phrase(c)} for c in family_columns(f, cols)] for f in families}


def phrase(column):
    if column in PHRASES:
        return PHRASES[column]
    if column.startswith("spec"):
        return "cross-reference community"
    if column.startswith("kw_"):
        return f"keyword {column[3:]}"
    kind, _, modulus = column.partition("_mod")
    return {"a_entropy": "balance", "a_top_share": "bias", "a_period": "period"}[kind] + f" mod {modulus}"


def family_columns(family, cols):
    graph_cols = [f"spec{i}" for i in range(SPECTRAL_DIMS)] + [f"kw_{k}" for k in KEYWORDS] + ["degree"]
    if family == "graph":
        return graph_cols
    numeric = [c[1] for c in cols if c[0] in ("growth", "arith", "recur")]
    if family == "all":
        return numeric + graph_cols
    return [c[1] for c in cols if c[0] == family]


def family_matrix(family, X, cols, graph):
    if family == "graph":
        return graph
    if family == "all":
        parts = [standardize(X[:, [i for i, c in enumerate(cols) if c[0] == f]]) for f in ("growth", "arith", "recur")]
        parts.append(graph * 0.5)
        return np.hstack(parts)
    idx = [i for i, c in enumerate(cols) if c[0] == family]
    return standardize(X[:, idx])


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


CLUSTER_SAMPLE = 120_000


def cluster(Y):
    """HDBSCAN on a subsample of the layout, the rest assigned to the nearest
    labelled points. Density clusters in two dimensions barely change past
    this sample size and the full run takes many times longer."""
    from sklearn.cluster import HDBSCAN
    from sklearn.neighbors import KNeighborsClassifier

    t = time.time()
    n = len(Y)
    rng = np.random.default_rng(7)
    pick = np.sort(rng.choice(n, min(n, CLUSTER_SAMPLE), replace=False))
    size = max(50, len(pick) // 1500)
    cap = len(pick) // 20
    sub = HDBSCAN(min_cluster_size=size, min_samples=10, max_cluster_size=cap, cluster_selection_method="eom", n_jobs=-1, copy=True).fit_predict(Y[pick])
    labels = np.full(n, -1, dtype=np.int64)
    labels[pick] = sub
    rest = np.setdiff1d(np.arange(n), pick)
    if len(rest):
        labels[rest] = KNeighborsClassifier(n_neighbors=7).fit(Y[pick], sub).predict(Y[rest])
    k = labels.max() + 1
    noise = np.mean(labels < 0)
    largest = np.bincount(labels[labels >= 0]).max() if k else 0
    log(f"hdbscan: {k} clusters, {noise:.1%} noise, largest {largest}, min size {size}, cap {cap}, sample {len(pick)}, in {time.time() - t:.0f}s")
    return labels


def tokens_for(name, kws):
    words = TOKEN.findall(name.lower())
    toks = {t for t in words if t not in STOP}
    toks |= {f"{a} {b}" for a, b in zip(words, words[1:]) if a not in STOP and b not in STOP}
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
        out[c] = [t.removeprefix("kw:") for t in pick_label(scored)]
    return out


def explain(Z, nn, limit=2):
    """For each neighbor, the columns where both points are alike and both sit
    away from the corpus mean: high shared magnitude, low difference."""
    out = np.zeros((nn.shape[0], nn.shape[1], limit), dtype=np.uint8)
    for start in range(0, len(Z), 20000):
        zi = Z[start : start + 20000]
        zj = Z[nn[start : start + 20000]]
        shared = np.abs(zi[:, None, :] + zj) / 2
        gap = np.abs(zi[:, None, :] - zj)
        score = shared - 2 * gap
        out[start : start + 20000] = np.argsort(-score, axis=2)[:, :, :limit]
    return out


GROWTH_CLASSES = ["periodic", "linear", "quadratic", "cubic or quartic", "higher polynomial", "exponential", "factorial", "other"]
# log10 slope per index of n^2 over 80 terms is 0.048; n^3 is 0.083.
SLOW_EXP_SLOPE = 0.05
FAST_EXP_SLOPE = 1.5
# Ratio trend of Catalan is 0.009 and of Bell is 0.030.
FACTORIAL_RATIO_TREND = 0.02
MAX_ORDER = 12
KEYWORD_GROUPS = [("core", 1), ("nice", 2), ("hard", 3), ("base", 4), ("mult", 5), ("tabl", 6), ("tabf", 6), ("cons", 7), ("easy", 8)]


def growth_class(c):
    periodic = (c["r_period"] > 0) | (c["r_eventually_constant"] > 0)
    poly = c["r_poly"] > 0
    # r_diff_degree counts differences taken, one more than the polynomial degree.
    degree = np.where(poly, c["r_diff_degree"] - 1, np.rint(c["g_poly_slope"]))
    by_degree = np.select([degree < 1, degree == 1, degree == 2, degree <= 4], [7, 1, 2, 3], 4)
    slow = c["g_exp_slope"] < SLOW_EXP_SLOPE
    resid = np.stack([c["g_poly_resid"], c["g_exp_resid"], c["g_fact_resid"]])
    factorial = (c["g_ratio_trend"] > FACTORIAL_RATIO_TREND) | (resid.argmin(axis=0) == 2)
    exponential = (c["g_exp_slope"] <= FAST_EXP_SLOPE) & (np.abs(c["g_ratio_trend"]) <= FACTORIAL_RATIO_TREND)
    return np.select([periodic, poly | slow, factorial, exponential], [0, by_degree, 6, 5], 7)


def keyword_group(kws):
    return next((code for k, code in KEYWORD_GROUPS if k in kws), 0)


def color_codes(X, cols, keywords):
    """Three bytes per sequence: growth class, recurrence order, keyword group."""
    c = {name: X[:, i] for i, (_, name) in enumerate(cols)}
    order = np.where(c["r_found"] > 0, np.minimum(c["r_order"], MAX_ORDER), 0)
    group = [keyword_group(k) for k in keywords]
    return np.stack([growth_class(c), order, group], axis=1).astype(np.uint8)


def histogram(name, codes, labels=None):
    counts = np.bincount(codes)
    text = ", ".join(f"{labels[i] if labels else i}: {n}" for i, n in enumerate(counts))
    log(f"{name}: {text}")


SHARD_SIZE = 100
NOISE = 65535


def shard_key(number):
    return f"A{number:06d}"


def shard_file(number):
    return f"{number // SHARD_SIZE:05d}.json"


def shard_groups(numbers):
    groups = {}
    for i, n in enumerate(numbers):
        groups.setdefault(shard_file(int(n)), []).append(i)
    return groups


def write_shard_pack(path, numbers, groups, entry):
    """Every shard of one kind as a gzip member in a single pack file, with
    <kind>.index.json mapping the shard name to its byte offset and length, so
    one object per kind is uploaded and the Worker serves shards by range.
    Returns the mean raw and gzipped size in KB."""
    path.parent.mkdir(parents=True, exist_ok=True)
    index = {}
    raw = offset = 0
    with open(path, "wb") as pack:
        for name, members in groups.items():
            doc = {shard_key(int(numbers[i])): entry(i) for i in members}
            text = json.dumps(doc, separators=(",", ":")).encode()
            body = gzip.compress(text, 6, mtime=0)
            pack.write(body)
            index[name.removesuffix(".json")] = [offset, len(body)]
            offset += len(body)
            raw += len(text)
    path.with_suffix(".index.json").write_text(json.dumps(index, separators=(",", ":")))
    return raw / len(groups) / 1024, offset / len(groups) / 1024


def read_layout(path):
    """Positions in embedding units and the bounds a layout file was written with."""
    raw = path.read_bytes()
    count = struct.unpack_from("<I", raw, 4)[0]
    bounds = np.array(struct.unpack_from("<4f", raw, 8), dtype=np.float64)
    q = np.frombuffer(raw[24:], dtype="<u2").reshape(count, 2).astype(np.float64)
    lo, hi = bounds[:2], bounds[2:]
    return (lo + q / 65535 * (hi - lo)).astype(np.float32), bounds


def write_layout(path, Y, bounds=None):
    if bounds is None:
        lo = Y.min(axis=0)
        hi = Y.max(axis=0)
    else:
        lo, hi = np.asarray(bounds[:2]), np.asarray(bounds[2:])
    Y = np.clip(Y, lo, hi)
    q = np.round((Y - lo) / np.maximum(hi - lo, 1e-9) * 65535).astype(np.uint16)
    with open(path, "wb") as f:
        f.write(b"ATL1")
        f.write(struct.pack("<I", len(Y)))
        f.write(struct.pack("<4f", *lo, *hi))
        f.write(q.tobytes())
    return q


def run_embed(features_dir, out, families, sample, epochs):
    t0 = time.time()
    data = load(features_dir)
    if sample and sample < len(data.numbers):
        rng = np.random.default_rng(1)
        data = take(data, np.sort(rng.choice(len(data.numbers), sample, replace=False)))
    X, cols, numbers, names, keywords = data.X, data.cols, data.numbers, data.names, data.keywords
    log(f"loaded {X.shape[0]} sequences, {X.shape[1]} features")
    numbers.tofile(out / "numbers.u32")
    with open(out / "names.txt", "w") as f:
        f.write("\n".join(names))
    graph = graph_features(numbers, keywords, data.xrefs) if needs_graph(families) else None

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
        np.where(labels < 0, NOISE, labels).astype(np.uint16).tofile(out / f"{family}.cluster.u16")
        clusters = []
        for c, toks in label_text.items():
            m = labels == c
            clusters.append({"id": int(c), "label": " ".join(toks), "size": int(m.sum()), "cx": float(Y[m, 0].mean()), "cy": float(Y[m, 1].mean())})
        clusters.sort(key=lambda c: -c["size"])
        json.dump(clusters, open(out / f"{family}.clusters.json", "w"))
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
    json.dump(report, open(out / f"report-{'-'.join(families)}.json", "w"), indent=1)
    log(f"done in {report['seconds']}s")


def write_manifest(path, count, families, snapshot):
    manifest = {"version": time.strftime("%Y%m%d"), "count": int(count), "families": list(families), "snapshot": snapshot}
    json.dump(manifest, open(path, "w"))
    return manifest


def run_shards(features_dir, out, snapshot):
    t0 = time.time()
    numbers = np.fromfile(out / "numbers.u32", dtype=np.uint32)
    data = load(features_dir)
    index = {int(n): i for i, n in enumerate(data.numbers)}
    data = take(data, [index[int(n)] for n in numbers])
    families = [f for f in FAMILIES if (out / f"{f}.knn.npz").exists()]
    log(f"{len(numbers)} sequences, families {', '.join(families)}")
    graph = graph_features(numbers, data.keywords, data.xrefs) if needs_graph(families) else None
    clusters = {}
    for f in families:
        path = out / f"{f}.cluster.u16"
        if path.exists():
            clusters[f] = np.fromfile(path, dtype=np.uint16)
    json.dump(feature_names(families, data.cols), open(out / "features.json", "w"))
    color = color_codes(data.X, data.cols, data.keywords)
    color.tofile(out / "color.u8")
    histogram("growth class", color[:, 0], GROWTH_CLASSES)
    histogram("recurrence order", color[:, 1])
    histogram("keyword group", color[:, 2], ["none"] + [k for k, _ in KEYWORD_GROUPS if k != "tabf"])
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
        why = explain(M, nn)

        def near(i):
            return [[int(numbers[j]), int(a), int(b)] for j, (a, b) in zip(nn[i], why[i])]

        raw, packed = write_shard_pack(out / "shards" / f"{f}.pack", numbers, groups, near)
        log(f"shards/{f}.pack: {len(groups)} shards, {raw:.1f} KB raw, {packed:.1f} KB gzipped each")
    log(f"manifest: {write_manifest(out / 'manifest.json', len(numbers), families, snapshot)}")
    log(f"done in {time.time() - t0:.0f}s")


PLACE_K = 15


def place_new(M, old_rows, new_rows, positions, clusters):
    """Position and cluster for each new row from its nearest old rows in
    feature space: the distance-weighted mean of their positions and the
    commonest of their clusters, noise only when every neighbor is noise."""
    old = M[old_rows].astype(np.float32)
    old_sq = np.einsum("ij,ij->i", old, old)
    pos = np.zeros((len(new_rows), 2), dtype=np.float32)
    lab = np.full(len(new_rows), NOISE, dtype=np.uint16)
    for start in range(0, len(new_rows), 256):
        chunk = M[new_rows[start : start + 256]].astype(np.float32)
        d2 = old_sq[None, :] - 2 * chunk @ old.T + np.einsum("ij,ij->i", chunk, chunk)[:, None]
        k = min(PLACE_K, len(old_rows))
        near = np.argpartition(d2, k - 1, axis=1)[:, :k]
        for r in range(len(chunk)):
            idx = near[r]
            w = 1.0 / (np.sqrt(np.maximum(d2[r, idx], 0)) + 1e-6)
            pos[start + r] = (positions[idx] * w[:, None]).sum(axis=0) / w.sum()
            votes = clusters[idx]
            real = votes[votes != NOISE]
            if len(real):
                lab[start + r] = np.bincount(real).argmax()
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
    numbers = np.array(kept + added, dtype=np.uint32)
    data = take(data, [current[int(n)] for n in numbers])
    old_rows = np.arange(len(kept))
    new_rows = np.arange(len(kept), len(numbers))
    prev_index = {int(n): i for i, n in enumerate(prev_numbers)}
    prev_rows = np.array([prev_index[n] for n in kept], dtype=np.int64)
    graph = graph_features(numbers, data.keywords, data.xrefs) if needs_graph(families) else None
    numbers.tofile(out / "numbers.u32")
    for f in families:
        M = family_matrix(f, data.X, data.cols, graph)
        positions, bounds = read_layout(prev / f"{f}.layout.bin")
        clusters = np.fromfile(prev / f"{f}.cluster.u16", dtype=np.uint16)
        positions, clusters = positions[prev_rows], clusters[prev_rows]
        if len(new_rows):
            pos, lab = place_new(M, old_rows, new_rows, positions, clusters)
            positions = np.vstack([positions, pos])
            clusters = np.concatenate([clusters, lab])
        write_layout(out / f"{f}.layout.bin", positions, bounds)
        clusters.tofile(out / f"{f}.cluster.u16")
        info = json.load(open(prev / f"{f}.clusters.json"))
        sizes = np.bincount(clusters[clusters != NOISE], minlength=len(info))
        for c in info:
            c["size"] = int(sizes[c["id"]]) if c["id"] < len(sizes) else 0
        json.dump(info, open(out / f"{f}.clusters.json", "w"))
        cache = out / f"{f}.knn.npz"
        if cache.exists():
            cache.unlink()
        knn_graph(M, cache)
        log(f"{f}: {len(new_rows)} placed, {int((clusters[new_rows] == NOISE).sum()) if len(new_rows) else 0} as noise")
    log(f"placed in {time.time() - t0:.0f}s")
    run_shards(features_dir, out, snapshot)


def main():
    args = sys.argv[1:]
    if len(args) < 3 or args[0] not in ("embed", "shards", "place"):
        raise SystemExit(__doc__)
    mode = args[0]
    features_dir = Path(args[1])
    prev = None
    if mode == "place":
        if len(args) < 4:
            raise SystemExit(__doc__)
        prev = Path(args[2])
        args = args[:2] + args[3:]
    out = Path(args[2])
    out.mkdir(parents=True, exist_ok=True)
    families = FAMILIES
    sample = 0
    epochs = 200
    snapshot = None
    i = 3
    while i < len(args):
        if args[i] == "--families" and mode == "embed":
            families = args[i + 1].split(",")
            i += 2
        elif args[i] == "--sample" and mode == "embed":
            sample = int(args[i + 1])
            i += 2
        elif args[i] == "--epochs" and mode == "embed":
            epochs = int(args[i + 1])
            i += 2
        elif args[i] == "--snapshot" and mode in ("shards", "place"):
            snapshot = args[i + 1]
            i += 2
        else:
            raise SystemExit(__doc__)
    if mode == "embed":
        run_embed(features_dir, out, families, sample, epochs)
    elif mode == "place" and snapshot and prev:
        run_place(features_dir, prev, out, snapshot)
    elif mode == "shards" and snapshot:
        run_shards(features_dir, out, snapshot)
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
