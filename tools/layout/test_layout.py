import gzip
import json
import struct

import numpy as np

import layout
from atlas import codes, embed, features
from atlas import format as fmt

COLOR_COLUMNS = [
    "g_poly_slope",
    "g_poly_resid",
    "g_exp_slope",
    "g_exp_resid",
    "g_fact_resid",
    "g_ratio_trend",
    "r_order",
    "r_found",
    "r_diff_degree",
    "r_poly",
    "r_period",
    "r_eventually_constant",
]

# Feature values the Rust tool computes for A000012, A000290, A000079, A000142.
ONES = {"r_order": 1, "r_found": 1, "r_diff_degree": 1, "r_poly": 1, "r_period": 1, "r_eventually_constant": 1}
SQUARES = {
    "g_poly_slope": 2.0,
    "g_exp_slope": 0.048,
    "g_exp_resid": 0.319,
    "g_fact_resid": 0.385,
    "g_ratio_trend": -0.004,
    "r_order": 3,
    "r_found": 1,
    "r_diff_degree": 3,
    "r_poly": 1,
}
POWERS_OF_TWO = {
    "g_poly_slope": 6.784,
    "g_poly_resid": 1.242,
    "g_exp_slope": 0.302,
    "g_exp_resid": 0.048,
    "g_fact_resid": 0.391,
    "r_order": 1,
    "r_found": 1,
    "r_diff_degree": 11,
}
FACTORIALS = {
    "g_poly_slope": 14.859,
    "g_poly_resid": 3.3,
    "g_exp_slope": 1.014,
    "g_exp_resid": 0.844,
    "g_fact_resid": 0.092,
    "g_ratio_trend": 0.051,
    "r_order": 13,
    "r_diff_degree": 11,
}


def rows(*values):
    X = np.zeros((len(values), len(COLOR_COLUMNS)), dtype=np.float32)
    for i, v in enumerate(values):
        for name, x in v.items():
            X[i, COLOR_COLUMNS.index(name)] = x
    return X


def test_layout_header_and_quantized_point(tmp_path):
    Y = np.array([[-1.0, 2.0], [3.0, 6.0], [1.0, 3.0]], dtype=np.float32)
    q = fmt.write_layout(tmp_path / "f.layout.bin", Y)
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
    assert embed.explain(Z, nn)[0].tolist() == [[0, 1], [2, 1]]


def test_color_codes_for_known_sequences():
    cols = [("test", name) for name in COLOR_COLUMNS]
    X = rows(ONES, SQUARES, POWERS_OF_TWO, FACTORIALS)
    keywords = [["nonn", "core", "easy", "mult"], ["nonn", "tabl", "easy"], ["hard", "nonn"], ["nonn"]]
    c = codes.color_codes(X, cols, keywords)
    assert c.dtype == np.uint8 and c.shape == (4, 3)
    assert c[:, 0].tolist() == [0, 2, 5, 6]
    assert c[:, 1].tolist() == [1, 3, 1, 0]
    assert c[:, 2].tolist() == [1, 6, 3, 0]


def test_recurrence_order_is_capped():
    cols = [("test", name) for name in COLOR_COLUMNS]
    c = codes.color_codes(rows({"r_order": 40, "r_found": 1}), cols, [[]])
    assert c[0, 1] == 12


def test_shard_naming_and_grouping(tmp_path):
    numbers = np.array([1, 99, 100, 199, 250], dtype=np.uint32)
    assert fmt.shard_key(45) == "A000045"
    assert fmt.shard_file(250) == "00002.json"
    groups = fmt.shard_groups(numbers)
    assert list(groups) == ["00000.json", "00001.json", "00002.json"]
    fmt.write_shard_pack(tmp_path / "base.pack", numbers, groups, lambda i: int(numbers[i]) * 2)
    index = json.loads((tmp_path / "base.index.json").read_text())
    assert list(index) == ["00000", "00001", "00002"]
    pack = (tmp_path / "base.pack").read_bytes()
    offset, length = index["00001"]
    assert json.loads(gzip.decompress(pack[offset : offset + length])) == {"A000100": 200, "A000199": 398}
    assert sum(length for _, length in index.values()) == len(pack)


def test_label_prefers_bigram_over_its_tokens():
    names = (
        ["twin primes below n"] * 5
        + ["twin primes above n"] * 3
        + ["primes dividing n"] * 6
        + ["twin towers"] * 6
        + ["number of primes"] * 5
    )
    labels = np.array([0] * 8 + [-1] * 17)
    assert embed.label_clusters(labels, names, [[]] * len(names)) == {0: ["twin primes", "below"]}


def test_label_ties_are_deterministic():
    scored = [(1.0, "zeta"), (1.0, "alpha"), (1.0, "beta gamma"), (1.0, "alpha beta")]
    assert embed.pick_label(scored) == ["alpha beta", "zeta"]


def test_label_tokens_skip_stop_words_and_keep_keywords():
    assert embed.tokens_for("Least prime whose twin primes are given", ["nonn", "hard"]) == {
        "prime",
        "twin",
        "primes",
        "twin primes",
        "kw:hard",
    }


def test_feature_names_follow_the_family_matrix_columns():
    cols = [("growth", "g_poly_slope"), ("arith", "a_entropy_mod2"), ("recur", "r_order")]
    names = features.feature_names(["recur", "graph"], cols)
    assert names["recur"] == [{"name": "r_order", "phrase": "recurrence order"}]
    assert names["graph"][0] == {"name": "spec0", "phrase": "cross-reference community"}
    assert names["graph"][-1] == {"name": "degree", "phrase": "number of cross references"}
    assert len(names["graph"]) == features.SPECTRAL_DIMS + len(features.KEYWORDS) + 1
    assert all(" " not in n["name"] and "_" not in n["phrase"] for f in names.values() for n in f)


def test_manifest(tmp_path):
    written = fmt.write_manifest(tmp_path / "manifest.json", 3, ["growth", "all"], "2026-10-15", {"k": 1})
    assert json.loads((tmp_path / "manifest.json").read_text()) == written
    assert written["count"] == 3 and written["families"] == ["growth", "all"] and written["snapshot"] == "2026-10-15"
    assert len(written["version"]) == 8 and written["version"].isdigit()
    assert written["params"] == {"k": 1}


def test_place_new_lands_between_its_neighbors_and_inherits_their_cluster():
    M = np.array([[0.0, 0.0], [1.0, 0.0], [0.0, 1.0], [10.0, 10.0], [0.3, 0.3]], dtype=np.float32)
    positions = np.array([[0.0, 0.0], [2.0, 0.0], [0.0, 2.0], [50.0, 50.0]], dtype=np.float32)
    clusters = np.array([7, 7, fmt.NOISE, 3], dtype=np.uint16)
    old = np.arange(4)
    new = np.array([4])
    pos, lab = layout.place_new(M, old, new, positions, clusters)
    assert lab.tolist() == [7]
    assert 0.0 < pos[0, 0] < 2.0 and 0.0 < pos[0, 1] < 2.0
    assert np.hypot(*pos[0]) < 5.0


def test_read_layout_round_trips_write_layout_with_fixed_bounds(tmp_path):
    Y = np.array([[-1.0, 2.0], [3.0, 6.0], [9.0, -9.0]], dtype=np.float32)
    fmt.write_layout(tmp_path / "f.layout.bin", Y, bounds=[-1.0, 2.0, 3.0, 6.0])
    back, bounds = fmt.read_layout(tmp_path / "f.layout.bin")
    assert bounds.tolist() == [-1.0, 2.0, 3.0, 6.0]
    assert np.allclose(back[:2], Y[:2], atol=1e-3)
    assert back[2].tolist() == [3.0, 2.0]


def test_place_new_with_all_noise_neighbors_stays_noise():
    M = np.array([[0.0, 0.0], [1.0, 0.0], [0.5, 0.5]], dtype=np.float32)
    positions = np.array([[0.0, 0.0], [2.0, 0.0]], dtype=np.float32)
    clusters = np.array([fmt.NOISE, fmt.NOISE], dtype=np.uint16)
    _, lab = layout.place_new(M, np.arange(2), np.array([2]), positions, clusters)
    assert lab.tolist() == [fmt.NOISE]


def tiny_out_dir(tmp_path, n=6):
    """A six sequence out dir with one family's neighbor graph, enough for run_shards."""
    cols = [("growth" if c.startswith("g_") else "recur", c) for c in COLOR_COLUMNS]
    rng = np.random.default_rng(3)
    X = rng.normal(size=(n, len(cols))).astype(np.float32)
    numbers = np.arange(1, n + 1, dtype=np.uint32)
    data = features.Data(
        X, cols, numbers, [f"seq {i}" for i in range(n)], [["nonn"]] * n, ["1,2,3"] * n, [1] * n, np.zeros((0, 2))
    )
    numbers.tofile(tmp_path / "numbers.u32")
    idx = np.array([[i] + [j for j in range(n) if j != i] for i in range(n)])
    np.savez(tmp_path / "growth.knn.npz", idx=idx, dist=np.ones(idx.shape))
    np.array([0, 0, 1, fmt.NOISE, 1, 0], dtype=np.uint16).tofile(tmp_path / "growth.cluster.u16")
    return data, numbers


def test_features_json_publishes_labels_and_format_beside_the_columns(tmp_path):
    data, numbers = tiny_out_dir(tmp_path)
    layout.run_shards(tmp_path, "2026-10-15", data, numbers, None)
    doc = json.loads((tmp_path / "features.json").read_text())
    assert set(doc) == {"growth", "labels", "format"}
    assert doc["growth"] == [{"name": c, "phrase": features.phrase(c)} for c in COLOR_COLUMNS if c.startswith("g_")]
    assert doc["labels"]["growth"] == codes.GROWTH_CLASSES and len(doc["labels"]["growth"]) == 8
    assert len(doc["labels"]["order"]) == 8 and doc["labels"]["order"][-1] == "none up to order 12"
    assert len(doc["labels"]["keyword"]) == 9 and doc["labels"]["keyword"][0] == "none of these"
    assert doc["labels"]["keyword"][6] == "tabl or tabf"
    assert doc["format"] == {"noise": 65535, "shardSize": 100, "quantMax": 65535, "neighbors": 20}
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest["params"] == embed.PARAMS and manifest["count"] == 6
    index = json.loads((tmp_path / "shards" / "base.index.json").read_text())
    assert list(index) == ["00000"]
