"""Cloning in silico: digest and ligate, Golden Gate and Gibson assembly.

Each returns the product with its parts in order. (The screen also carries features
through an assembly; the operations do not return features, so that is left out here.)
A part is a dict: ``{id, name, seq, topology}``.
"""
from .digest import digest, find_cuts
from .dna import reverse_complement
from .enzymes import enzyme_by_name
from .primers import melting_temp


def _oriented(src, reverse):
    frag = src["frag"]
    if not reverse:
        return {"src": src, "reverse": False, "seq": frag["seq"], "left": frag["left"], "right": frag["right"]}

    def flip(e):
        return {"kind": e["kind"], "sense": reverse_complement(e["sense"])}

    return {
        "src": src, "reverse": True, "seq": reverse_complement(frag["seq"]),
        "left": flip(frag["right"]), "right": flip(frag["left"]),
    }


def _ends_join(a, b):
    return a["kind"] == b["kind"] and a["sense"] == b["sense"]


def _is_palindrome(s):
    return len(s) > 0 and reverse_complement(s) == s


def _ligation_orders(sources, circular, limit):
    results = []
    if not sources:
        return results
    first, rest = sources[0], sources[1:]
    start = _oriented(first, False)

    def recurse(chain, left):
        if len(results) >= limit:
            return
        if not left:
            last = chain[-1]
            if _ends_join(last["right"], chain[0]["left"]) if circular else True:
                results.append(chain)
            return
        last = chain[-1]
        for i in range(len(left)):
            for reverse in (False, True):
                p = _oriented(left[i], reverse)
                if _ends_join(last["right"], p["left"]):
                    recurse(chain + [p], [x for k, x in enumerate(left) if k != i])

    recurse([start], rest)
    return results


def _build(method, chain, circular):
    seq = chain[0]["seq"]
    parts = []
    junctions = []

    def place(p, start_at, skip_left):
        src = p["src"]["part"]
        length = len(p["src"]["frag"]["seq"])
        parts.append({
            "partId": src["id"], "name": src["name"], "strand": -1 if p["reverse"] else 1,
            "start": start_at + skip_left + 1, "end": start_at + length,
        })

    place(chain[0], 0, 0)
    for p in chain[1:]:
        overlap = len(p["left"]["sense"])
        start_at = len(seq) - overlap
        junctions.append({"seq": p["left"]["sense"]})
        seq += p["seq"][overlap:]
        place(p, start_at, overlap)
    closing = len(chain[-1]["right"]["sense"])
    if circular:
        junctions.append({"seq": chain[0]["left"]["sense"]})
        seq = seq[: len(seq) - closing]
        parts[-1]["end"] = min(parts[-1]["end"], len(seq))
    return {
        "method": method, "seq": seq, "topology": "circular" if circular else "linear",
        "parts": parts, "junctions": junctions, "warnings": [],
    }


def _check_overhangs(product):
    seen = {}
    for j in product["junctions"]:
        if not j["seq"]:
            continue
        if _is_palindrome(j["seq"]):
            product["warnings"].append("palindromicOverhang")
        seen[j["seq"]] = seen.get(j["seq"], 0) + 1
    for count in seen.values():
        if count > 1:
            product["warnings"].append("duplicateOverhang")


def sorted_fragments(part, enzymes):
    """Fragments of a part's digest, largest first, so indices are stable."""
    return sorted(digest(part["seq"], part["topology"], enzymes), key=lambda f: -f["size"])


def digest_and_ligate(inputs, circular=True, limit=8):
    """Cut each part with its enzymes, take the chosen fragments, and find the ways they join.

    Each input is ``{part, enzymes, pick}``; pick is 'largest', 'smallest' or a list of indices.
    """
    sources = []
    warnings = []
    for item in inputs:
        frags = sorted_fragments(item["part"], item["enzymes"])
        pick = item["pick"]
        if pick == "largest":
            chosen = frags[:1]
        elif pick == "smallest":
            chosen = frags[-1:]
        else:
            chosen = [frags[i] for i in pick if 0 <= i < len(frags)]
        if not chosen:
            warnings.append("noFragmentFromPart")
        for frag in chosen:
            sources.append({"part": item["part"], "frag": frag})
    products = []
    for chain in _ligation_orders(sources, circular, limit):
        p = _build("ligation", chain, circular)
        _check_overhangs(p)
        products.append(p)
    return {"products": products, "warnings": warnings}


def _carries_site(frag, enzyme_name):
    e = enzyme_by_name(enzyme_name)
    if not e:
        return False
    return len(find_cuts(frag["seq"], "linear", {**e, "top": 0, "bottom": 0})) > 0


def golden_gate(parts, enzyme_name, limit=8):
    """One Type IIS enzyme cuts every part; order and orientation follow from the overhangs."""
    warnings = []
    if not enzyme_by_name(enzyme_name):
        return {"products": [], "warnings": ["unknownEnzyme"]}
    sources = []
    for part in parts:
        productive = [
            f for f in digest(part["seq"], part["topology"], [enzyme_name])
            if f["leftEnzyme"] is not None and f["rightEnzyme"] is not None
            and f["left"]["kind"] != "blunt" and f["right"]["kind"] != "blunt"
            and not _carries_site(f, enzyme_name)
        ]
        if not productive:
            warnings.append("noFragmentFromPart")
        if len(productive) > 1:
            warnings.append("manyFragmentsFromPart")
        for frag in productive:
            sources.append({"part": part, "frag": frag})
    products = []
    for chain in _ligation_orders(sources, True, limit):
        p = _build("golden_gate", chain, True)
        _check_overhangs(p)
        products.append(p)
    if len(products) > 1:
        warnings.append("ambiguousOrder")
    return {"products": products, "warnings": warnings}


DEFAULT_GIBSON = {"minOverlap": 15, "maxOverlap": 120, "ordered": False, "limit": 6}


def overlap_length(a, b, minimum, maximum):
    """Longest k with the end of a equal to the start of b."""
    for k in range(min(len(a), len(b), maximum), minimum - 1, -1):
        if a.endswith(b[:k]):
            return k
    return 0


def _gibson_piece(part, reverse):
    return {"part": part, "reverse": reverse, "seq": reverse_complement(part["seq"]) if reverse else part["seq"]}


def gibson(parts, options=None):
    """Gibson assembly of linear parts that share end overlaps."""
    o = {**DEFAULT_GIBSON, **(options or {})}
    warnings = []
    if any(p["topology"] != "linear" for p in parts):
        warnings.append("notLinear")
    if not parts:
        return {"products": [], "warnings": warnings}
    chains = []
    first = _gibson_piece(parts[0], False)

    def dfs(chain, overlaps, left):
        if len(chains) >= o["limit"]:
            return
        last = chain[-1]
        if not left:
            close = overlap_length(last["seq"], chain[0]["seq"], o["minOverlap"], o["maxOverlap"])
            if close > 0 and len(chain) > 1:
                chains.append({"chain": chain, "overlaps": overlaps + [close], "circular": True})
            elif len(chain) == len(parts) and close == 0:
                chains.append({"chain": chain, "overlaps": overlaps, "circular": False})
            return
        candidates = [left[0]] if o["ordered"] else left
        for nxt in candidates:
            for reverse in (False, True):
                p = _gibson_piece(nxt, reverse)
                k = overlap_length(last["seq"], p["seq"], o["minOverlap"], o["maxOverlap"])
                if k > 0:
                    dfs(chain + [p], overlaps + [k], [x for x in left if x is not nxt])

    dfs([first], [], list(parts[1:]))
    chains.sort(key=lambda c: 0 if c["circular"] else 1)
    products = []
    for c in chains:
        chain, overlaps, circular = c["chain"], c["overlaps"], c["circular"]
        seq = chain[0]["seq"]
        placed = []
        junctions = []
        product_warnings = []

        def add_piece(p, start_at, skip_left):
            placed.append({
                "partId": p["part"]["id"], "name": p["part"]["name"], "strand": -1 if p["reverse"] else 1,
                "start": start_at + skip_left + 1, "end": start_at + len(p["seq"]),
            })

        add_piece(chain[0], 0, 0)
        for i in range(1, len(chain)):
            k = overlaps[i - 1]
            start_at = len(seq) - k
            ov = chain[i]["seq"][:k]
            junctions.append({"seq": ov, "tm": melting_temp(ov)})
            seq += chain[i]["seq"][k:]
            add_piece(chain[i], start_at, k)
        if circular:
            k = overlaps[-1]
            ov = chain[0]["seq"][:k]
            junctions.append({"seq": ov, "tm": melting_temp(ov)})
            seq = seq[: len(seq) - k]
        for j in junctions:
            if len(j["seq"]) < 20:
                product_warnings.append("shortOverlap")
            if j["tm"] < 48:
                product_warnings.append("lowOverlapTm")
        products.append({
            "method": "gibson", "seq": seq, "topology": "circular" if circular else "linear",
            "parts": placed, "junctions": junctions, "warnings": list(dict.fromkeys(product_warnings)),
        })
    if not products:
        warnings.append("noAssembly")
    if len(products) > 1:
        warnings.append("ambiguousOrder")
    return {"products": products, "warnings": warnings}
