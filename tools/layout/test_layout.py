import json
import struct

import numpy as np

import layout

COLOUR_COLUMNS = [
    "g_poly_slope", "g_poly_resid", "g_exp_slope", "g_exp_resid", "g_fact_resid", "g_ratio_trend",
    "r_order", "r_found", "r_diff_degree", "r_poly", "r_period", "r_eventually_constant",
]

# Feature values the Rust tool computes for A000012, A000290, A000079, A000142.
ONES = {"r_order": 1, "r_found": 1, "r_diff_degree": 1, "r_poly": 1, "r_period": 1, "r_eventually_constant": 1}
SQUARES = {"g_poly_slope": 2.0, "g_exp_slope": 0.048, "g_exp_resid": 0.319, "g_fact_resid": 0.385, "g_ratio_trend": -0.004, "r_order": 3, "r_found": 1, "r_diff_degree": 3, "r_poly": 1}
POWERS_OF_TWO = {"g_poly_slope": 6.784, "g_poly_resid": 1.242, "g_exp_slope": 0.302, "g_exp_resid": 0.048, "g_fact_resid": 0.391, "r_order": 1, "r_found": 1, "r_diff_degree": 11}
FACTORIALS = {"g_poly_slope": 14.859, "g_poly_resid": 3.3, "g_exp_slope": 1.014, "g_exp_resid": 0.844, "g_fact_resid": 0.092, "g_ratio_trend": 0.051, "r_order": 13, "r_diff_degree": 11}


def rows(*values):
    X = np.zeros((len(values), len(COLOUR_COLUMNS)), dtype=np.float32)
    for i, v in enumerate(values):
        for name, x in v.items():
            X[i, COLOUR_COLUMNS.index(name)] = x
    return X


def test_layout_header_and_quantised_point(tmp_path):
    Y = np.array([[-1.0, 2.0], [3.0, 6.0], [1.0, 3.0]], dtype=np.float32)
    q = layout.write_layout(tmp_path / "f.layout.bin", Y)
    raw = (tmp_path / "f.layout.bin").read_bytes()
    assert raw[:4] == b"ATL1"
    count, x0, y0, x1, y1 = struct.unpack_from("<I4f", raw, 4)
    assert (count, x0, y0, x1, y1) == (3, -1.0, 2.0, 3.0, 6.0)
    points = np.frombuffer(raw[24:], dtype="<u2").reshape(3, 2)
    assert points.tolist() == q.tolist() == [[0, 0], [65535, 65535], [32768, 16384]]
    x = x0 + points[2, 0] / 65535 * (x1 - x0)
    y = y0 + points[2, 1] / 65535 * (y1 - y0)
    assert abs(x - 1.0) < 1e-4 and abs(y - 3.0) < 1e-4


def test_explain_picks_shared_extreme_columns():
    Z = np.array([[3.0, 0.0, 0.0], [3.0, 0.0, 2.0], [0.0, 2.0, 0.0]], dtype=np.float32)
    nn = np.array([[1, 2], [0, 2], [0, 1]])
    # Row 0 against row 1: column 0 shares 3 with no gap, column 1 is 0, column 2 scores 1 - 4.
    # Row 0 against row 2: column 2 is 0, column 1 scores 1 - 4, column 0 scores 1.5 - 6.
    assert layout.explain(Z, nn)[0].tolist() == [[0, 1], [2, 1]]


def test_colour_codes_for_known_sequences():
    cols = [("test", name) for name in COLOUR_COLUMNS]
    X = rows(ONES, SQUARES, POWERS_OF_TWO, FACTORIALS)
    keywords = [["nonn", "core", "easy", "mult"], ["nonn", "tabl", "easy"], ["hard", "nonn"], ["nonn"]]
    codes = layout.colour_codes(X, cols, keywords)
    assert codes.dtype == np.uint8 and codes.shape == (4, 3)
    assert codes[:, 0].tolist() == [0, 2, 5, 6]
    assert codes[:, 1].tolist() == [1, 3, 1, 0]
    assert codes[:, 2].tolist() == [1, 6, 3, 0]


def test_recurrence_order_is_capped():
    cols = [("test", name) for name in COLOUR_COLUMNS]
    codes = layout.colour_codes(rows({"r_order": 40, "r_found": 1}), cols, [[]])
    assert codes[0, 1] == 12


def test_shard_naming_and_grouping(tmp_path):
    assert layout.shard_key(45) == "A000045"
    assert layout.shard_file(45) == "00000.json"
    assert layout.shard_file(123456) == "01234.json"
    numbers = np.array([45, 99, 100, 199, 200], dtype=np.uint32)
    groups = layout.shard_groups(numbers)
    assert groups == {"00000.json": [0, 1], "00001.json": [2, 3], "00002.json": [4]}
    layout.write_shard_dir(tmp_path / "base", numbers, groups, lambda i: int(numbers[i]) * 2)
    assert sorted(p.name for p in (tmp_path / "base").iterdir()) == ["00000.json", "00001.json", "00002.json"]
    assert json.loads((tmp_path / "base" / "00001.json").read_text()) == {"A000100": 200, "A000199": 398}


def test_label_prefers_bigram_over_its_tokens():
    names = ["twin primes below n"] * 5 + ["twin primes above n"] * 3 + ["primes dividing n"] * 6 + ["twin towers"] * 6 + ["number of primes"] * 5
    labels = np.array([0] * 8 + [-1] * 17)
    assert layout.label_clusters(labels, names, [[]] * len(names)) == {0: ["twin primes", "below"]}


def test_label_ties_are_deterministic():
    scored = [(1.0, "zeta"), (1.0, "alpha"), (1.0, "beta gamma"), (1.0, "alpha beta")]
    assert layout.pick_label(scored) == ["alpha beta", "zeta"]


def test_label_tokens_skip_stop_words_and_keep_keywords():
    assert layout.tokens_for("Least prime whose twin primes are given", ["nonn", "hard"]) == {"prime", "twin", "primes", "twin primes", "kw:hard"}


def test_feature_names_follow_the_family_matrix_columns():
    cols = [("growth", "g_poly_slope"), ("arith", "a_entropy_mod2"), ("recur", "r_order")]
    names = layout.feature_names(["recur", "graph"], cols)
    assert names["recur"] == [{"name": "r_order", "phrase": "recurrence order"}]
    assert names["graph"][0] == {"name": "spec0", "phrase": "cross-reference community"}
    assert names["graph"][-1] == {"name": "degree", "phrase": "number of cross references"}
    assert len(names["graph"]) == layout.SPECTRAL_DIMS + len(layout.KEYWORDS) + 1
    assert all(" " not in n["name"] and "_" not in n["phrase"] for f in names.values() for n in f)


def test_manifest(tmp_path):
    written = layout.write_manifest(tmp_path / "manifest.json", 3, ["growth", "all"], "2026-10-15")
    assert json.loads((tmp_path / "manifest.json").read_text()) == written
    assert written["count"] == 3 and written["families"] == ["growth", "all"] and written["snapshot"] == "2026-10-15"
    assert len(written["version"]) == 8 and written["version"].isdigit()
