import gzip
import itertools
import json
import os
import struct
import subprocess
from pathlib import Path

import numpy as np
import pytest

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


FIXTURE = Path(__file__).resolve().parents[1] / "tests" / "oeisdata"
ATLAS_BIN = Path(os.environ.get("ATLAS_BIN", Path(__file__).resolve().parents[1] / "target" / "release" / "atlas"))


@pytest.fixture(scope="session")
def fixture_features(tmp_path_factory):
    """Feature output of the release binary over the twelve committed .seq files."""
    if not ATLAS_BIN.exists():
        pytest.fail(f"{ATLAS_BIN} is missing; run cargo build --release in tools or set ATLAS_BIN")
    out = tmp_path_factory.mktemp("features")
    subprocess.run([str(ATLAS_BIN), "features", str(FIXTURE), str(out)], check=True, capture_output=True)
    return out


def test_meta_header_matches_what_load_expects(fixture_features):
    header = (fixture_features / "meta.tsv").read_text().splitlines()[0].split("\t")
    assert header == features.META_HEADER


def test_color_codes_for_known_sequences(fixture_features):
    data = features.load(fixture_features)
    c = codes.color_codes(data.X, data.cols, data.keywords)
    assert c.dtype == np.uint8 and c.shape == (12, 3)
    by_number = {int(n): row.tolist() for n, row in zip(data.numbers, c, strict=True)}
    assert by_number[12] == [0, 1, 1]
    assert by_number[290] == [2, 3, 1]
    assert by_number[79] == [5, 1, 1]
    assert by_number[142] == [6, 0, 1]
    assert [codes.GROWTH_CLASSES[by_number[n][0]] for n in (27, 578, 108, 110)] == [
        "linear",
        "cubic or quartic",
        "exponential",
        "factorial",
    ]


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
    assert names["graph"][-1] == {"name": "kw_word", "phrase": "keyword word"}
    assert len(names["graph"]) == features.SPECTRAL_DIMS + len(features.KEYWORDS)
    assert all(" " not in n["name"] and "_" not in n["phrase"] for f in names.values() for n in f)


def test_manifest(tmp_path):
    written = fmt.write_manifest(tmp_path / "manifest.json", 3, ["growth", "all"], "2026-10-15", {"k": 1})
    assert json.loads((tmp_path / "manifest.json").read_text()) == written
    assert written["count"] == 3 and written["families"] == ["growth", "all"] and written["snapshot"] == "2026-10-15"
    assert len(written["version"]) == 8 and written["version"].isdigit()
    assert written["params"] == {"k": 1}


def test_place_new_lands_on_the_nearest_neighbor_inside_the_voted_cluster():
    # Three old rows of cluster 7 on one island and two of cluster 3 on another, far apart in
    # the layout; the new row sits between them in feature space, so a weighted mean of all
    # five positions would land in the empty space between the islands.
    M = np.array([[0.0, 0.0], [1.0, 0.0], [0.0, 1.0], [2.0, 2.0], [3.0, 2.0], [1.2, 1.0]], dtype=np.float32)
    positions = np.array([[0.0, 0.0], [2.0, 0.0], [0.0, 2.0], [50.0, 50.0], [52.0, 50.0]], dtype=np.float32)
    clusters = np.array([7, 7, 7, 3, 3], dtype=np.uint16)
    pos, lab = layout.place_new(M, np.arange(5), np.array([5]), positions, clusters)
    assert lab.tolist() == [7]
    assert pos[0].tolist() == [2.0, 0.0]


def test_place_new_ignores_noise_neighbors_in_the_vote():
    M = np.array([[0.0, 0.0], [1.0, 0.0], [0.0, 1.0], [10.0, 10.0], [0.3, 0.3]], dtype=np.float32)
    positions = np.array([[0.0, 0.0], [2.0, 0.0], [0.0, 2.0], [50.0, 50.0]], dtype=np.float32)
    clusters = np.array([7, 7, fmt.NOISE, 3], dtype=np.uint16)
    pos, lab = layout.place_new(M, np.arange(4), np.array([4]), positions, clusters)
    assert lab.tolist() == [7]
    assert pos[0].tolist() == [0.0, 0.0]


def test_read_layout_round_trips_write_layout_with_fixed_bounds(tmp_path):
    Y = np.array([[-1.0, 2.0], [3.0, 6.0], [9.0, -9.0]], dtype=np.float32)
    fmt.write_layout(tmp_path / "f.layout.bin", Y, bounds=[-1.0, 2.0, 3.0, 6.0])
    back, bounds = fmt.read_layout(tmp_path / "f.layout.bin")
    assert bounds.tolist() == [-1.0, 2.0, 3.0, 6.0]
    assert np.allclose(back[:2], Y[:2], atol=1e-3)
    assert back[2].tolist() == [3.0, 2.0]


def test_place_new_with_all_noise_neighbors_stays_noise_at_the_weighted_mean():
    M = np.array([[0.0, 0.0], [1.0, 0.0], [0.5, 0.5]], dtype=np.float32)
    positions = np.array([[0.0, 0.0], [2.0, 0.0]], dtype=np.float32)
    clusters = np.array([fmt.NOISE, fmt.NOISE], dtype=np.uint16)
    pos, lab = layout.place_new(M, np.arange(2), np.array([2]), positions, clusters)
    assert lab.tolist() == [fmt.NOISE]
    assert np.allclose(pos[0], [1.0, 0.0], atol=1e-4)


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


def test_graph_features_place_a_node_by_its_neighbors_not_its_degree():
    # Two cliques of four joined by one bridge edge, plus a hub cited by every node of
    # both. The hub's row must not stand apart from the cliques, and the two cliques
    # must separate along the leading column.
    numbers = np.arange(1, 10, dtype=np.uint32)
    edges = [(a, b) for a in range(1, 5) for b in range(a + 1, 5)]
    edges += [(a, b) for a in range(5, 9) for b in range(a + 1, 9)]
    edges += [(4, 5)] + [(i, 9) for i in range(1, 9)]
    old = features.SPECTRAL_DIMS
    features.SPECTRAL_DIMS = 2
    try:
        G = features.graph_features(numbers, [["core"]] + [[]] * 8, np.array(edges, dtype=np.uint32))
    finally:
        features.SPECTRAL_DIMS = old
    assert G.shape == (9, 2 + len(features.KEYWORDS))
    spec = G[:, :2]
    assert np.sign(spec[:4, 0]).tolist() != np.sign(spec[4:8, 0]).tolist()
    hub_gap = np.linalg.norm(spec[8] - spec[:8].mean(axis=0))
    clique_gap = np.linalg.norm(spec[:4].mean(axis=0) - spec[4:8].mean(axis=0))
    assert hub_gap < clique_gap
    assert G[0, 2 + features.KEYWORDS.index("core")] == embed.PARAMS["keyword_weight"]


def test_combined_matrix_hits_the_target_block_shares():
    rng = np.random.default_rng(5)
    n = 4000
    cols = [("growth", f"g_{i}") for i in range(19)]
    cols += [
        ("arith", f"a_{k}_mod{m}") for m in (2, 3, 4, 5, 6, 7, 8, 9, 10, 16) for k in ("entropy", "top_share", "period")
    ]
    cols += [("arith", f"a_{s}") for s in ("frac_prime", "frac_distinct", "frac_square", "gcd_log", "frac_even")]
    cols += [("recur", f"r_{i}") for i in range(9)]
    X = (rng.normal(size=(n, len(cols))) * rng.uniform(0.1, 30, size=len(cols))).astype(np.float32)
    graph = np.hstack([rng.normal(size=(n, 32)), rng.uniform(size=(n, 25)) < 0.2]).astype(np.float32)
    kept = features.combined_blocks(cols)
    assert len(kept["arith"]) == 7 * 2 + 5 and len(kept["growth"]) == 19 and len(kept["recur"]) == 9
    assert all(
        "top_share" not in cols[i][1] and not cols[i][1].endswith(("mod4", "mod6", "mod10")) for i in kept["arith"]
    )
    saved = embed.PARAMS["combined_weights"]
    embed.PARAMS["combined_weights"] = {"growth": 0.35, "recur": 0.25, "arith": 0.25, "graph": 0.15}
    try:
        M = features.family_matrix("all", X, cols, graph)
    finally:
        embed.PARAMS["combined_weights"] = saved
    names = features.family_columns("all", cols)
    assert M.shape == (n, len(names)) and names[-1] == "kw_word" and names[19] == "a_entropy_mod2"
    var = M.astype(np.float64).var(axis=0)
    edges = np.cumsum([0, 19, 19, 9, 57])
    shares = [var[a:b].sum() / var.sum() for a, b in itertools.pairwise(edges)]
    assert np.allclose(shares, [0.35, 0.25, 0.25, 0.15], atol=0.02)
    assert set(embed.PARAMS["combined_scales"]) == {"growth", "arith", "recur", "graph"}


def test_weights_flag_overrides_only_the_named_families():
    assert layout.parse_weights("growth=0.5,graph=0.1") == {"growth": 0.5, "recur": 0.25, "arith": 0.25, "graph": 0.1}
    with pytest.raises(Exception, match="unknown family"):
        layout.parse_weights("spectral=1")
