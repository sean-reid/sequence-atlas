"""Artifact formats the site reads; shared/format.ts is the TypeScript mirror of these constants."""

import gzip
import json
import struct
import time

import numpy as np

NOISE = 65535
SHARD_SIZE = 100
QUANT_MAX = 65535
NEIGHBORS = 20
FORMAT = {"noise": NOISE, "shardSize": SHARD_SIZE, "quantMax": QUANT_MAX, "neighbors": NEIGHBORS}


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
    return (lo + q / QUANT_MAX * (hi - lo)).astype(np.float32), bounds


def write_layout(path, Y, bounds=None):
    if bounds is None:
        lo = Y.min(axis=0)
        hi = Y.max(axis=0)
    else:
        lo, hi = np.asarray(bounds[:2]), np.asarray(bounds[2:])
    Y = np.clip(Y, lo, hi)
    q = np.round((Y - lo) / np.maximum(hi - lo, 1e-9) * QUANT_MAX).astype(np.uint16)
    with open(path, "wb") as f:
        f.write(b"ATL1")
        f.write(struct.pack("<I", len(Y)))
        f.write(struct.pack("<4f", *lo, *hi))
        f.write(q.tobytes())
    return q


def write_manifest(path, count, families, snapshot, params):
    manifest = {
        "version": time.strftime("%Y%m%d"),
        "build": "local",
        "count": int(count),
        "families": list(families),
        "snapshot": snapshot,
        "params": params,
    }
    path.write_text(json.dumps(manifest))
    return manifest
