"""Restriction sites, virtual digests and the gel they would make.

All positions are 0-based cut points: a cut at p lies between base p-1 and p.
"""
import math
from decimal import ROUND_HALF_UP, Decimal

from .dna import find_pattern, reverse_complement
from .enzymes import ENZYMES, enzyme_by_name


def _is_palindromic(site):
    return reverse_complement(site) == site


def find_cuts(seq, topology, enzyme):
    """Every cut one enzyme makes. Cuts that fall off a linear end are dropped."""
    n = len(seq)
    circular = topology == "circular"
    length = len(enzyme["site"])
    cuts = []

    def place(start, strand, top_off, bot_off):
        d = bot_off - top_off
        top = start + top_off
        if circular:
            top = top % n
        bottom = top + d
        if not circular and (top < 0 or top > n or bottom < 0 or bottom > n):
            return
        cuts.append({
            "enzyme": enzyme["name"],
            "siteStart": start % n,
            "siteEnd": (start + length) % n if circular else start + length,
            "strand": strand,
            "top": top,
            "bottom": bottom,
        })

    for p in find_pattern(seq, enzyme["site"], circular):
        place(p, 1, enzyme["top"], enzyme["bottom"])
    if not _is_palindromic(enzyme["site"]):
        rc_site = reverse_complement(enzyme["site"])
        for p in find_pattern(seq, rc_site, circular):
            place(p, -1, length - enzyme["bottom"], length - enzyme["top"])
    cuts.sort(key=lambda c: c["top"])
    return cuts


def map_sites(seq, topology, names=None):
    """Sites for a set of enzymes (all known enzymes when none are named)."""
    if names is not None:
        found = [enzyme_by_name(nm) for nm in names]
        listing = [e for e in found if e is not None]
    else:
        listing = list(ENZYMES)
    return [{"enzyme": e, "cuts": find_cuts(seq, topology, e)} for e in listing]


def unique_cutters(sites):
    return [s for s in sites if len(s["cuts"]) == 1]


_BLUNT = {"kind": "blunt", "sense": ""}


def _end_for(ext, off, cut):
    d = cut["bottom"] - cut["top"]
    if d == 0:
        return dict(_BLUNT)
    a = min(cut["top"], cut["bottom"])
    b = max(cut["top"], cut["bottom"])
    return {"kind": "5prime" if d > 0 else "3prime", "sense": ext[a + off : b + off]}


def digest(seq, topology, enzyme_names):
    """Cut a sequence at every site of the chosen enzymes and return the pieces in order."""
    n = len(seq)
    circular = topology == "circular"
    ext, off = (seq + seq + seq, n) if circular else (seq, 0)
    found = []
    for nm in enzyme_names:
        e = enzyme_by_name(nm)
        if e:
            found.extend(find_cuts(seq, topology, e))
    by_top = {}
    for c in found:
        if c["top"] not in by_top:
            by_top[c["top"]] = c
    cuts = sorted(by_top.values(), key=lambda c: c["top"])

    def make(c1, c2):
        t1 = c1["top"] if c1 else 0
        t2 = c2["top"] if c2 else n
        lo = min(t1, c1["bottom"] if c1 else t1)
        hi = max(t2, c2["bottom"] if c2 else t2)
        return {
            "start": lo % n,
            "seq": ext[lo + off : hi + off],
            "left": _end_for(ext, off, c1) if c1 else dict(_BLUNT),
            "right": _end_for(ext, off, c2) if c2 else dict(_BLUNT),
            "size": t2 - t1,
            "leftEnzyme": c1["enzyme"] if c1 else None,
            "rightEnzyme": c2["enzyme"] if c2 else None,
        }

    if not cuts:
        return [make(None, None)]
    out = []
    if circular:
        for i, c1 in enumerate(cuts):
            nx = cuts[(i + 1) % len(cuts)]
            if i == len(cuts) - 1:
                c2 = {"top": nx["top"] + n, "bottom": nx["bottom"] + n, "enzyme": nx["enzyme"]}
            else:
                c2 = nx
            out.append(make(c1, c2))
    else:
        out.append(make(None, cuts[0]))
        for i in range(len(cuts) - 1):
            out.append(make(cuts[i], cuts[i + 1]))
        out.append(make(cuts[-1], None))
    return [f for f in out if f["size"] > 0]


LADDER_1KB = [10000, 8000, 6000, 5000, 4000, 3000, 2000, 1500, 1000, 500]
LADDER_100BP = [1500, 1200, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100]


def gel_position(size, ladder=LADDER_1KB):
    hi = math.log10(max(ladder))
    lo = math.log10(min(ladder))
    x = (hi - math.log10(max(size, 1))) / (hi - lo)
    return min(1, max(0, 0.1 + 0.8 * x))


def gel_bands(sizes, ladder=LADDER_1KB, merge_within=0.02):
    bands = []
    for s in sorted(sizes, reverse=True):
        last = bands[-1] if bands else None
        if last and abs(last["size"] - s) / last["size"] <= merge_within:
            last["count"] += 1
        else:
            bands.append({"size": s, "position": gel_position(s, ladder), "count": 1})
    return bands


def format_bp(size):
    if size < 1000:
        return f"{size} bp"
    kb = size / 1000
    if kb == int(kb):
        return f"{int(kb)} kb"
    # toFixed(2) rounds an exact tie up, where Python's format rounds it to even.
    text = str(Decimal(kb).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)).rstrip("0")
    return f"{text} kb"
