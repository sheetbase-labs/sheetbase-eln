"""CRISPR guide finding: every site next to the nuclease's PAM, on either strand, with a
plain screen (GC, terminators, repeats) and a count of near matches in the same sequence."""
import re

from .dna import find_pattern, gc_fraction, js_round, reverse_complement

NUCLEASES = [
    {"key": "spcas9", "name": "SpCas9 (NGG)", "pam": "NGG", "guideLength": 20, "pamSide": "3prime", "cutFromPam": 3},
    {"key": "sacas9", "name": "SaCas9 (NNGRRT)", "pam": "NNGRRT", "guideLength": 21, "pamSide": "3prime", "cutFromPam": 3},
    {"key": "cas12a", "name": "Cas12a (TTTV)", "pam": "TTTV", "guideLength": 23, "pamSide": "5prime", "cutFromPam": 18},
]


def nuclease_by_key(key):
    return next((n for n in NUCLEASES if n["key"] == key), None)


def _scan(seq, nuclease, circular, strand):
    n = len(seq)
    L = nuclease["guideLength"]
    P = len(nuclease["pam"])
    span = L + P
    if n < span:
        return []
    strand_seq = seq if strand == 1 else reverse_complement(seq)
    three = nuclease["pamSide"] == "3prime"
    pattern = "N" * L + nuclease["pam"] if three else nuclease["pam"] + "N" * L
    out = []
    for at in find_pattern(strand_seq, pattern, circular):
        if circular and at + span > n:
            wrapped = strand_seq[at:] + strand_seq[: at + span - n]
        else:
            wrapped = strand_seq[at : at + span]
        proto = wrapped[:L] if three else wrapped[P:]
        pam = wrapped[L:] if three else wrapped[:P]
        proto_at = at if three else at + P
        start = proto_at % n if strand == 1 else (n - proto_at - L) % n
        out.append({"proto": proto, "pam": pam, "strand": strand, "start": start})
    return out


def _mismatches(a, b, limit):
    m = 0
    for x, y in zip(a, b):
        if x != y:
            m += 1
            if m > limit:
                return m
    return m


_RUN = re.compile(r"(.)\1{4,}")


def find_guides(seq_in, topology, nuclease, region=None, limit=None, max_mismatch=3):
    seq = seq_in.upper()
    n = len(seq)
    circular = topology == "circular"
    L = nuclease["guideLength"]
    sites = [
        s
        for s in _scan(seq, nuclease, circular, 1) + _scan(seq, nuclease, circular, -1)
        if not re.search(r"[^ACGT]", s["proto"])
    ]

    def in_region(s):
        return region is None or (s["start"] + 1 >= region["start"] and s["start"] + L <= region["end"])

    scored = []
    for s in filter(in_region, sites):
        gc = gc_fraction(s["proto"])
        warnings = []
        score = 100
        if gc < 0.3:
            warnings.append("lowGc")
            score -= 30
        elif gc < 0.4:
            score -= 10
        if gc > 0.8:
            warnings.append("highGc")
            score -= 30
        elif gc > 0.7:
            score -= 10
        if "TTTT" in s["proto"]:
            warnings.append("terminator")
            score -= 40
        if _RUN.search(s["proto"]):
            warnings.append("homopolymer")
            score -= 10
        scored.append((s, gc, warnings, score))
    scored.sort(key=lambda t: (-t[3], t[0]["start"]))
    top = scored[: 20 if limit is None else limit]
    out = []
    for s, gc, warnings, score in top:
        off_targets = [0] * (max_mismatch + 1)
        for o in sites:
            if o is s:
                continue
            m = _mismatches(s["proto"], o["proto"], max_mismatch)
            if m <= max_mismatch:
                off_targets[m] += 1
        penalty = min(30, sum(c * (max_mismatch - i) for i, c in enumerate(off_targets[1:])) * 3)
        adj = score - penalty - off_targets[0] * 20
        if off_targets[0] > 0 or any(c > 0 for c in off_targets[1:3]):
            warnings.append("offTargetClose")
        adj = max(0, min(100, adj))
        proto_end_top = s["start"] + L
        if nuclease["pamSide"] == "3prime":
            cut_after = proto_end_top - nuclease["cutFromPam"] if s["strand"] == 1 else s["start"] + nuclease["cutFromPam"]
        else:
            cut_after = s["start"] + nuclease["cutFromPam"] if s["strand"] == 1 else proto_end_top - nuclease["cutFromPam"]
        out.append({
            "protospacer": s["proto"], "pam": s["pam"], "strand": s["strand"],
            "start": s["start"] + 1, "end": s["start"] + L,
            "cutAfter": (cut_after - 1) % n + 1,
            "gc": gc, "score": js_round(adj), "warnings": warnings, "offTargets": off_targets,
        })
    return out
