"""Checking a Sanger read against the construct you meant to make."""
from .align import align_read, differences
from .dna import js_round

CONFIRM_QUALITY = 30


def decode_quality(s):
    return [ord(c) - 33 for c in s]


def trim_by_quality(quality, threshold=20, window=10):
    """Trim the poor ends of a read with a running-average quality test; returns the kept span."""
    n = len(quality)
    if n == 0:
        return {"start": 0, "end": 0}
    w = min(window, n)

    def mean(i):
        return sum(quality[i : i + w]) / w

    start = 0
    while start + w <= n and mean(start) < threshold:
        start += 1
    end = n
    while end - w >= start and mean(end - w) < threshold:
        end -= 1
    if start + w > n or end <= start:
        return {"start": 0, "end": 0}
    return {"start": start, "end": end}


def check_read(expected, topology, read):
    """Check one read ({name, bases, quality: list of ints}) against the expected sequence.

    The workbench also names the features a difference lands in; the operations
    pass no features, so that list is left out here.
    """
    q = list(read["quality"])
    trimmed = trim_by_quality(q)
    kept = read["bases"][trimmed["start"] : trimmed["end"]]
    kept_q = q[trimmed["start"] : trimmed["end"]]
    mean_quality = 0 if not kept_q else js_round(sum(kept_q) / len(kept_q) * 10) / 10
    none = {
        "name": read["name"], "verdict": "noAlignment", "strand": None, "trimmed": trimmed,
        "meanQuality": mean_quality, "covers": None, "identity": 0, "differences": [],
    }
    if len(kept) < 20:
        return none
    aln = align_read(expected, kept, topology == "circular")
    if not aln:
        return none
    n = len(expected)

    def quality_at(index):
        idx = index if aln["strand"] == 1 else len(kept) - 1 - index
        return kept_q[idx] if 0 <= idx < len(kept_q) else 0

    diffs = differences(aln, aln["refStart"] - aln["aStart"], 0)
    out = []
    for d in diffs:
        ref_pos = d["refPos"] % n
        if d["kind"] == "deletion":
            quality = min(quality_at(d["queryPos"] - 1), quality_at(d["queryPos"]))
        elif d["kind"] == "insertion":
            quality = min(quality_at(d["queryPos"] + i) for i in range(len(d["query"])))
        else:
            quality = quality_at(d["queryPos"])
        qi = min(max(d["queryPos"], 0), len(kept) - 1)
        read_index = trimmed["start"] + (qi if aln["strand"] == 1 else len(kept) - 1 - qi)
        out.append({
            "kind": d["kind"], "readIndex": read_index, "position": ref_pos + 1,
            "expected": d["ref"], "found": d["query"], "quality": quality,
            "confirmed": quality >= CONFIRM_QUALITY, "features": [],
        })
    confirmed = any(d["confirmed"] for d in out)
    verdict = "mismatch" if confirmed else ("review" if out else "matches")
    return {
        "name": read["name"], "verdict": verdict, "strand": aln["strand"], "trimmed": trimmed,
        "meanQuality": mean_quality,
        "covers": {"start": aln["refStart"] % n + 1, "end": (aln["refEnd"] - 1) % n + 1},
        "identity": js_round(aln["identity"] * 10000) / 10000,
        "differences": out,
    }
