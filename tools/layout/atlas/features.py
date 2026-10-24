"""The feature matrix the Rust tool writes and the per-family matrices built from it."""

import csv
import time
from typing import NamedTuple

import numpy as np
import scipy.sparse as sp
from scipy.sparse.linalg import LinearOperator, eigsh

from atlas import log
from atlas.embed import PARAMS

FAMILIES = ["growth", "arith", "recur", "graph", "all"]
KEYWORDS = [
    "base",
    "bref",
    "cofr",
    "cons",
    "core",
    "dumb",
    "easy",
    "eigen",
    "fini",
    "frac",
    "full",
    "hard",
    "hear",
    "less",
    "look",
    "more",
    "mult",
    "nice",
    "nonn",
    "obsc",
    "sign",
    "tabf",
    "tabl",
    "walk",
    "word",
]
SPECTRAL_DIMS = 32
META_HEADER = ["number", "nterms", "offset", "keywords", "name", "terms"]
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
    cols = [tuple(line.split("\t")) for line in (features_dir / "columns.tsv").read_text().splitlines()]
    X = np.fromfile(features_dir / "features.f32", dtype=np.float32).reshape(-1, len(cols))
    with open(features_dir / "meta.tsv", newline="") as f:
        reader = csv.reader(f, delimiter="\t", quoting=csv.QUOTE_NONE)
        header = next(reader)
        if header != META_HEADER:
            raise SystemExit(f"meta.tsv header is {header}, expected {META_HEADER}")
        meta = list(reader)
    numbers = np.array([int(r[0]) for r in meta], dtype=np.uint32)
    names = [r[4] for r in meta]
    keywords = [r[3].split(",") if r[3] else [] for r in meta]
    terms = [r[5] if len(r) > 5 else "" for r in meta]
    offsets = [int(r[2]) for r in meta]
    assert len(numbers) == X.shape[0]
    xrefs = np.loadtxt(features_dir / "xrefs.tsv", dtype=np.uint32, delimiter="\t", ndmin=2)
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
    clip = PARAMS["clip_percentile"]
    lo = np.percentile(M, clip, axis=0)
    hi = np.percentile(M, 100 - clip, axis=0)
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
    # Regularized normalized adjacency (Amini et al.): every pair gains tau/n of
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
    vals, vecs = eigsh(op, k=SPECTRAL_DIMS + 1, which="LA", tol=PARAMS["eigsh_tol"])
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
    degree = np.log1p(deg)[:, None].astype(np.float32)
    return np.hstack([spec.astype(np.float32), K * PARAMS["keyword_weight"], degree])


def needs_graph(families):
    return any(f in ("graph", "all") for f in families)


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
        parts.append(graph * PARAMS["graph_weight"])
        return np.hstack(parts)
    idx = [i for i, c in enumerate(cols) if c[0] == family]
    return standardize(X[:, idx])
