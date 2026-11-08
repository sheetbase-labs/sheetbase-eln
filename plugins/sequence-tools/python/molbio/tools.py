"""The molecular biology calculations as one function per action: restriction sites,
digests, primer design and checks, PCR, cloning products, alignment, CRISPR guides,
codon optimisation and Sanger read checks. Pure computation: nothing is read from
or written to the workspace.

Keys and results use the same camelCase names as the TypeScript tool they are
tested against (``test-vectors/``); ``ops.py`` renames them for the plugin's operations.
"""
from .align import align_pair
from .annotate import auto_annotate
from .assembly import digest_and_ligate, gibson, golden_gate
from .codon import HOSTS, CodonError, optimise_codons
from .crispr import NUCLEASES, find_guides, nuclease_by_key
from .digest import digest, format_bp, gel_bands, map_sites
from .dna import clean_dna, clean_input
from .primers import analyse_primer, design_primers, simulate_pcr
from .sanger import check_read, decode_quality

TOOL_MAX_BASES = 400_000
SHOWN_BASES = 20_000


def _show(seq):
    return {"seq": seq, "length": len(seq)} if len(seq) <= SHOWN_BASES else {"length": len(seq)}


def _too_long(*seqs):
    return any(len(s) > TOOL_MAX_BASES for s in seqs)


def _fail(message):
    return {"ok": False, "result": message}


def _ok(result):
    return {"ok": True, "result": result}


def run(data):
    """Run one calculation: ``data["action"]`` names it. Returns ``{ok, result}``."""
    action = data.get("action")
    fn = _ACTIONS.get(action)
    if fn is None:
        return _fail(f"Unknown action: {action}")
    return fn(data)


def _topology(d, default="circular"):
    return d.get("topology") or default


def _sites(d):
    seq = clean_input(d["sequence"])
    if _too_long(seq):
        return _fail("That sequence is too long.")
    unique = d.get("uniqueOnly")
    sites = []
    for s in map_sites(seq, _topology(d), d.get("enzymes")):
        keep = len(s["cuts"]) == 1 if unique else len(s["cuts"]) > 0
        if keep:
            sites.append({
                "enzyme": s["enzyme"]["name"], "site": s["enzyme"]["site"], "cuts": len(s["cuts"]),
                "positions": [c["top"] for c in s["cuts"][:20]],
            })
    return _ok({"length": len(seq), "sites": sites})


def _digest(d):
    seq = clean_input(d["sequence"])
    if _too_long(seq):
        return _fail("That sequence is too long.")
    pieces = digest(seq, _topology(d), d["enzymes"])
    return _ok({
        "fragments": [{
            "start": f["start"] + 1, "size": f["size"], "label": format_bp(f["size"]),
            "leftEnd": {"enzyme": f["leftEnzyme"], **f["left"]},
            "rightEnd": {"enzyme": f["rightEnzyme"], **f["right"]},
        } for f in pieces],
        "gelBands": [{"size": b["size"], "count": b["count"]} for b in gel_bands([f["size"] for f in pieces])],
    })


def _annotate(d):
    seq = clean_input(d["sequence"])
    if _too_long(seq):
        return _fail("That sequence is too long.")
    return _ok([
        {"label": f["label"], "type": f["type"], "start": f["start"], "end": f["end"], "strand": f["strand"]}
        for f in auto_annotate(seq, [])
    ])


def _primers(d):
    seq = clean_input(d["sequence"])
    if _too_long(seq):
        return _fail("That sequence is too long.")
    if d["end"] < d["start"] or d["end"] > len(seq):
        return _fail("The region must lie inside the sequence.")
    options = {}
    if d.get("targetTm"):
        options["optTm"] = d["targetTm"]
    if d.get("maxProduct"):
        options["maxProduct"] = d["maxProduct"]
    pairs = design_primers(seq, {"start": d["start"] - 1, "end": d["end"]}, options)
    fw_tail = clean_input(d.get("forwardTail") or "")
    rv_tail = clean_input(d.get("reverseTail") or "")
    return _ok([{
        "forward": {"seq": fw_tail + p["forward"]["seq"], "tm": p["forward"]["tm"], "gc": p["forward"]["gc"]},
        "reverse": {"seq": rv_tail + p["reverse"]["seq"], "tm": p["reverse"]["tm"], "gc": p["reverse"]["gc"]},
        "productSize": p["productSize"], "tmDiff": p["tmDiff"], "warnings": p["warnings"],
    } for p in pairs])


def _check_primer(d):
    r = analyse_primer(clean_input(d["primer"]))
    return _ok({
        "length": r["length"], "tm": r["tm"], "gc": r["gc"], "gcClamp": r["gcClamp"],
        "hairpinDeltaG": r["hairpin"]["deltaG"], "selfDimerDeltaG": r["selfDimer"]["deltaG"],
        "warnings": r["warnings"],
    })


def _pcr(d):
    template = clean_input(d["template"])
    if _too_long(template):
        return _fail("That template is too long.")
    products = simulate_pcr(template, clean_input(d["forward"]), clean_input(d["reverse"]),
                            _topology(d) == "circular")
    return _ok([{"start": p["start"] + 1, "end": p["end"], "size": p["size"], **_show(p["seq"])} for p in products])


def _assemble(d):
    parts = []
    for i, p in enumerate(d["parts"]):
        parts.append({
            "id": f"p{i + 1}", "name": p["name"], "seq": clean_input(p["sequence"]),
            "topology": p.get("topology") or "linear", "enzymes": p.get("enzymes"), "pick": p.get("pick"),
        })
    if any(_too_long(p["seq"]) for p in parts):
        return _fail("A part is too long.")
    method = d["method"]
    if method == "gibson":
        out = gibson(parts)
    elif method == "golden_gate":
        if not d.get("enzyme"):
            return _fail("Golden Gate needs an enzyme.")
        out = golden_gate(parts, d["enzyme"])
    else:
        out = digest_and_ligate([
            {"part": p, "enzymes": p["enzymes"] or [], "pick": p["pick"] if p["pick"] is not None else "largest"}
            for p in parts
        ])
    return _ok({
        "warnings": out["warnings"],
        "products": [{
            "method": p["method"], "topology": p["topology"], **_show(p["seq"]),
            "parts": [{"name": x["name"], "strand": x["strand"], "start": x["start"], "end": x["end"]}
                      for x in p["parts"]],
            "junctions": p["junctions"], "warnings": p["warnings"],
        } for p in out["products"]],
    })


def _align(d):
    a = clean_input(d["reference"])
    b = clean_input(d["query"])
    if _too_long(a, b) or len(a) * len(b) > 25_000_000:
        return _fail("Those sequences are too long to align here.")
    r = align_pair(a, b, {"mode": d.get("mode") or "local"})
    return _ok({
        "score": r["score"], "identity": r["identity"], "matches": r["matches"],
        "mismatches": r["mismatches"], "gaps": r["gaps"],
        "reference": {"start": r["aStart"] + 1, "end": r["aEnd"]},
        "query": {"start": r["bStart"] + 1, "end": r["bEnd"]},
    })


def _crispr(d):
    seq = clean_input(d["sequence"])
    if _too_long(seq):
        return _fail("That sequence is too long.")
    nuclease = nuclease_by_key(d.get("nuclease") or "spcas9") or NUCLEASES[0]
    region = None
    if d.get("start") is not None and d.get("end") is not None:
        region = {"start": d["start"], "end": d["end"]}
    return _ok({
        "nuclease": nuclease["name"],
        "note": "A screen of GC, terminators and near matches inside this sequence only; check the genome before ordering.",
        "guides": find_guides(seq, _topology(d), nuclease, region=region, limit=d.get("limit")),
    })


def _codon(d):
    import re

    raw = clean_input(d["sequence"])
    is_protein = d["input"] == "protein"
    text = re.sub(r"[^A-Z*]", "", d["sequence"].upper()) if is_protein else raw
    if len(text) == 0 or len(text) > TOOL_MAX_BASES:
        return _fail("Give a coding sequence or protein of a sensible length.")
    if not is_protein and len(raw) % 3 != 0:
        return _fail("A coding sequence must be a whole number of codons.")
    try:
        r = optimise_codons(
            protein=text if is_protein else None, dna=None if is_protein else raw,
            host=d["host"], avoid_enzymes=d.get("avoidEnzymes"), max_run=d.get("maxRun"),
        )
    except CodonError as e:
        return _fail(str(e))
    host = next((h["name"] for h in HOSTS if h["key"] == d["host"]), None)
    return _ok({"host": host, **r})


def _check_read(d):
    expected = clean_input(d["expected"])
    read = clean_input(d["read"])
    if _too_long(expected, read):
        return _fail("That sequence is too long.")
    quality = decode_quality(d["quality"]) if d.get("quality") else [40] * len(read)
    if len(quality) != len(read):
        return _fail("The quality string must have one character per base.")
    c = check_read(expected, _topology(d), {"name": "read", "bases": read, "quality": quality})
    return _ok({
        "verdict": c["verdict"], "strand": c["strand"], "covers": c["covers"], "identity": c["identity"],
        "meanQuality": c["meanQuality"],
        "differences": [{
            "kind": x["kind"], "position": x["position"], "expected": x["expected"], "found": x["found"],
            "quality": x["quality"], "confirmed": x["confirmed"],
        } for x in c["differences"][:50]],
    })


_ACTIONS = {
    "sites": _sites, "digest": _digest, "annotate": _annotate, "primers": _primers,
    "check_primer": _check_primer, "pcr": _pcr, "assemble": _assemble, "align": _align,
    "crispr": _crispr, "codon_optimise": _codon, "check_read": _check_read,
}

__all__ = ["run", "TOOL_MAX_BASES", "clean_dna"]
