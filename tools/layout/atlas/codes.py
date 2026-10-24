"""The three color bytes per sequence and the legend strings the site shows for them."""

import numpy as np

from atlas import log

GROWTH_CLASSES = [
    "periodic",
    "linear",
    "quadratic",
    "cubic or quartic",
    "higher polynomial",
    "exponential",
    "factorial",
    "other",
]
# log10 slope per index of n^2 over 80 terms is 0.048; n^3 is 0.083.
SLOW_EXP_SLOPE = 0.05
FAST_EXP_SLOPE = 1.5
# Ratio trend of Catalan is 0.009 and of Bell is 0.030.
FACTORIAL_RATIO_TREND = 0.02
MAX_ORDER = 12
ORDER_LABELS = [
    "order 1",
    "order 2",
    "order 3",
    "order 4",
    "order 5 or 6",
    "order 7 to 9",
    "order 10 to 12",
    "none up to order 12",
]
KEYWORD_GROUPS = [
    ("core", 1),
    ("nice", 2),
    ("hard", 3),
    ("base", 4),
    ("mult", 5),
    ("tabl", 6),
    ("tabf", 6),
    ("cons", 7),
    ("easy", 8),
]
KEYWORD_LABELS = ["none of these", "core", "nice", "hard", "base", "mult", "tabl or tabf", "cons", "easy"]
LABELS = {"growth": GROWTH_CLASSES, "order": ORDER_LABELS, "keyword": KEYWORD_LABELS}


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
