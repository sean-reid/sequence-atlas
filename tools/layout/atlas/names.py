"""Island names and descriptions. An island is named by the kind of sequence most
of its members are, else by its most cited member when that member sits inside
it, else by a phrase most members share, else by the growth or recurrence
structure most members have."""

import math
import re
from collections import Counter

import numpy as np

from atlas.codes import GROWTH_CLASSES
from atlas.embed import PARAMS

# Keywords that name a kind of sequence, in plain words.
KINDS = {
    "cons": "decimal expansions of constants",
    "cofr": "continued fractions",
    "tabl": "triangles read by rows",
    "tabf": "irregular tables",
    "mult": "multiplicative functions",
    "base": "digit-based sequences",
    "frac": "fractions, numerators and denominators",
    "more": "hard-to-compute counts",
    "walk": "lattice walks",
    "word": "sequences about words",
    "fini": "finite sequences",
}
# The order the rules are tried, per family. A single-measure family leads with
# its own structure; the combined and reference maps lead with the kind.
RULES = {
    "growth": ("growth", "kind", "exemplar", "phrase", "order"),
    "recur": ("order", "kind", "exemplar", "phrase", "growth"),
    "arith": ("kind", "exemplar", "phrase", "growth", "order"),
    "graph": ("kind", "exemplar", "phrase", "growth", "order"),
    "all": ("kind", "exemplar", "phrase", "growth", "order"),
}
STOP = frozenset(
    (
        "a",
        "an",
        "the",
        "of",
        "for",
        "and",
        "or",
        "with",
        "in",
        "to",
        "on",
        "by",
        "at",
        "is",
        "are",
        "as",
        "that",
        "which",
        "whose",
        "where",
        "from",
        "into",
        "than",
        "not",
        "no",
        "if",
        "all",
        "such",
        "its",
        "this",
        "be",
        "when",
        "then",
        "also",
        "each",
        "any",
        "other",
        "over",
        "under",
        "number",
        "numbers",
        "sequence",
        "sequences",
        "called",
        "sometimes",
        "denoted",
        "given",
        "one",
        "two",
        "three",
        "first",
        "second",
        "n",
        "k",
        "m",
        "x",
        "y",
        "z",
        "i",
        "e",
        "g",
    )
)
WORD = re.compile(r"[a-z][a-z0-9'-]*")
HEAD_SPLIT = re.compile(r":|\s\(|;|, the |, also|, or |, where|\. ")
HEAD_STRIP = re.compile(r"^(The |Number of |a\(n\) (is|=) )")
HEAD_REJECT = re.compile(
    r"[{}<>_=*+/^|\[\]\"()]"
    r"|\bA\d{6}\b"
    r"|^(if|from|let|for|a\(\d|expansion of|triangle read|array read|table read|irregular triangle|numbers? [a-z] such|length of)\b"
    r"|\b(of|and|the|or|by|with|for|in|to|from|into|within|that|such|whose|which|minus|plus|times|[eo]\.g\.f)$"
    r"|^period \d",
    re.IGNORECASE,
)
HEAD_MAX = 36
HEAD_MIN_LETTERS = 6
# A qualifier drawn from a member of a kind drops the kind's own words.
KIND_PREFIX = re.compile(r"^(decimal expansion of|continued fraction (for|of|expansion of)) (the )?", re.IGNORECASE)


def head(name):
    """The naming part of an OEIS name, or None when the name has no clean short form."""
    s = HEAD_SPLIT.split(name, 1)[0].strip().rstrip(".")
    s = HEAD_STRIP.sub("", s).strip()
    if not 3 <= len(s) <= HEAD_MAX or HEAD_REJECT.search(s):
        return None
    if sum(ch.isalpha() for ch in s) < HEAD_MIN_LETTERS:
        return None
    return s


def phrases(name):
    """Two- and three-word runs of content words; base-6 and the like lose their number."""
    toks = [re.sub(r"-\d+$", "", t) for t in WORD.findall(name.lower())]
    toks = [None if t in STOP or len(t) < 2 else t for t in toks]
    out = set()
    for n in (2, 3):
        for i in range(len(toks) - n + 1):
            run = toks[i : i + n]
            if all(run):
                out.add(" ".join(run))
    return out


def growth_text(code):
    cls = GROWTH_CLASSES[code]
    return f"{'irregular' if cls == 'other' else cls} growth"


def order_text(order):
    return f"order-{order} linear recurrences"


def citations(numbers, xrefs):
    """How many sequences reference each row, from the (from, to) pairs of A-numbers."""
    indeg = np.zeros(len(numbers), dtype=np.int64)
    if len(xrefs):
        pos = np.searchsorted(numbers, xrefs[:, 1])
        pos = np.minimum(pos, len(numbers) - 1)
        hit = numbers[pos] == xrefs[:, 1]
        np.add.at(indeg, pos[hit], 1)
    return indeg


def fame(indeg, number, kws):
    boost = 3.0 if "core" in kws else 1.5 if "nice" in kws else 1.0
    return indeg * boost / (1 + number / 200_000)


def short(name, number):
    return head(name) or f"A{number:06d}"


def name_islands(family, labels, numbers, names, keywords, color, indeg, knn):
    """{cluster id: (label, description)} for every non-noise cluster id in labels."""
    n_total = len(labels)
    corpus = Counter()
    docs = [phrases(nm) for nm in names]
    for d in docs:
        corpus.update(d)
    rules = RULES[family]
    results = {}
    for c in range(labels.max() + 1):
        rows = np.flatnonzero(labels == c)
        m = len(rows)
        if m == 0:
            continue
        kws = [set(keywords[i]) for i in rows]
        found = {}
        kind, kind_n = (Counter(k for ks in kws for k in ks if k in KINDS).most_common(1) or [(None, 0)])[0]
        kind_share = kind_n / m
        if kind and kind_share >= PARAMS["name_kind_share"]:
            found["kind"] = KINDS[kind]
        g, g_n = Counter(color[rows, 0].tolist()).most_common(1)[0]
        if g_n / m >= PARAMS["name_structure_share"]:
            found["growth"] = growth_text(g)
        o, o_n = Counter(color[rows, 1].tolist()).most_common(1)[0]
        if o > 0 and o_n / m >= PARAMS["name_structure_share"]:
            found["order"] = order_text(o)
        tf = Counter()
        for i in rows:
            tf.update(docs[i])
        phrase, best, cov = None, 0.0, 0.0
        for g_, cnt in tf.items():
            share = cnt / m
            if share < PARAMS["name_phrase_share"]:
                continue
            # Among phrases at least three times as common here as in the corpus,
            # the one most members share wins over the rarest.
            if math.log(share / (corpus[g_] / n_total)) < PARAMS["name_phrase_lift"]:
                continue
            if share > best:
                phrase, best, cov = g_, share, share
        if phrase:
            found["phrase"] = phrase
        ranked = sorted(rows.tolist(), key=lambda i: -fame(indeg[i], int(numbers[i]), keywords[i]))[:6]
        median = max(float(np.median(indeg[rows])), 1.0)
        mainland = m >= PARAMS["name_mainland_share"] * n_total and not any(
            k in found for k in ("kind", "growth", "order")
        )
        exemplar = None
        for i in ranked:
            cohesion = np.isin(knn[i], rows).mean()
            if (
                head(names[i])
                and indeg[i] >= PARAMS["name_exemplar_refs"]
                and indeg[i] >= PARAMS["name_exemplar_ratio"] * median
                and cohesion >= PARAMS["name_exemplar_cohesion"]
            ):
                exemplar = i
                break
        if exemplar is not None and not mainland:
            found["exemplar"] = f"{head(names[exemplar])} and relatives"
        order = ("kind", *rules) if kind_share >= PARAMS["name_kind_strong"] else rules
        label = next((found[r] for r in order if r in found), "mixed")
        structure = ", ".join(found[k] for k in ("kind", "growth", "order") if k in found) or "mixed"
        description = f"{m:,} sequences, {structure}"
        if phrase:
            description += f"; {cov:.0%} mention '{phrase}'"
        famous = [short(names[i], int(numbers[i])) for i in ranked[:2]]
        description += f". Includes {', '.join(famous)}."
        # The qualifier is the best-known member with a clean name; for a kind,
        # the best-known member of that kind.
        pool = [i for i in rows.tolist() if kind in keywords[i]] if "kind" in found else rows.tolist()
        pool = sorted(pool, key=lambda i: -fame(indeg[i], int(numbers[i]), keywords[i]))[:6]
        qualifier = next((head(names[i]) for i in pool if head(names[i])), None)
        if qualifier and "kind" in found:
            qualifier = KIND_PREFIX.sub("", qualifier) or None
        results[c] = (label, description, qualifier)
    return disambiguate(results)


def disambiguate(results):
    """Repeated labels within a family gain a qualifier when the island has one."""
    counts = Counter(label for label, _, _ in results.values())
    out = {}
    for c, (label, description, qualifier) in results.items():
        if counts[label] > 1 and qualifier and qualifier not in label:
            label = f"{label}, near {qualifier}" if label == "mixed" else f"{label} ({qualifier})"
        out[c] = (label, description)
    return out
