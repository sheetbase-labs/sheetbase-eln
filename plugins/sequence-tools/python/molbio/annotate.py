"""Finding the usual suspects in a sequence: a library of short, common elements
(promoters, tags, sites, sequencing primers) and open reading frames."""
from .dna import find_pattern, reverse_complement

_LIBRARY = [
    ("T7 promoter", "promoter", "TAATACGACTCACTATAG"),
    ("T3 promoter", "promoter", "AATTAACCCTCACTAAAGGG"),
    ("SP6 promoter", "promoter", "ATTTAGGTGACACTATAG"),
    ("lac operator", "protein_bind", "AATTGTGAGCGGATAACAATT"),
    ("T7 terminator", "terminator", "CTAGCATAACCCCTTGGGGCCTCTAAACGGGTCTTGAGGGGTTTTTTG"),
    ("Kozak", "misc_feature", "GCCACCATGG"),
    ("6xHis", "misc_feature", "CATCACCATCACCATCAC"),
    ("6xHis", "misc_feature", "CACCACCACCACCACCAC"),
    ("6xHis", "misc_feature", "CATCATCATCATCATCAT"),
    ("FLAG", "misc_feature", "GACTACAAGGACGACGATGACAAG"),
    ("HA tag", "misc_feature", "TACCCATACGATGTTCCAGATTACGCT"),
    ("Myc tag", "misc_feature", "GAACAAAAACTCATCTCAGAAGAGGATCTG"),
    ("V5 tag", "misc_feature", "GGTAAGCCTATCCCTAACCCTCTCCTCGGTCTCGATTCTACG"),
    ("Strep-tag II", "misc_feature", "TGGAGCCACCCGCAGTTCGAAAAA"),
    ("TEV site", "misc_feature", "GAAAACCTGTATTTTCAGGGC"),
    ("Thrombin site", "misc_feature", "CTGGTGCCGCGCGGCAGC"),
    ("SV40 NLS", "misc_feature", "CCAAAGAAGAAGCGGAAGGTT"),
    ("loxP", "misc_recomb", "ATAACTTCGTATAGCATACATTATACGAAGTTAT"),
    ("FRT", "misc_recomb", "GAAGTTCCTATTCTCTAGAAAGTATAGGAACTTC"),
    ("M13 fwd", "primer_bind", "GTAAAACGACGGCCAGT"),
    ("M13 rev", "primer_bind", "CAGGAAACAGCTATGAC"),
    ("T7 primer", "primer_bind", "TAATACGACTCACTATAGGG"),
    ("T7 term primer", "primer_bind", "GCTAGTTATTGCTCAGCGG"),
    ("CMV fwd primer", "primer_bind", "CGCAAATGGGCGGTAGGCGTG"),
    ("BGH rev primer", "primer_bind", "TAGAAGGCACAGTCGAGG"),
]
FEATURE_LIBRARY = [{"label": a, "type": b, "seq": c} for a, b, c in _LIBRARY]

_BASES = "TCAG"
_AA = "FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG"
CODE = {}
_i = 0
for _a in _BASES:
    for _b in _BASES:
        for _c in _BASES:
            CODE[_a + _b + _c] = _AA[_i]
            _i += 1


def translate(dna):
    """Standard-code translation; a trailing stop is dropped, unknown codons are X."""
    up = dna.upper().replace("U", "T")
    out = "".join(CODE.get(up[i : i + 3], "X") for i in range(0, len(up) - len(up) % 3, 3))
    return out[:-1] if out.endswith("*") else out


def find_orfs(seq, min_amino_acids=75):
    """Open reading frames from ATG to a stop on both strands (linear reading)."""
    out = []
    n = len(seq)
    for strand in (1, -1):
        s = seq if strand == 1 else reverse_complement(seq)
        for frame in range(3):
            i = frame
            while i + 3 <= n:
                if s[i : i + 3] == "ATG":
                    j = i
                    stop = -1
                    while j + 3 <= n:
                        if s[j : j + 3] in ("TAA", "TAG", "TGA"):
                            stop = j + 3
                            break
                        j += 3
                    if stop > 0:
                        aa = (stop - i) // 3 - 1
                        if aa >= min_amino_acids:
                            if strand == 1:
                                out.append({"start": i, "end": stop, "strand": strand, "aminoAcids": aa})
                            else:
                                out.append({"start": n - stop, "end": n - i, "strand": strand, "aminoAcids": aa})
                        i = stop
                        continue
                    break
                i += 3
    out.sort(key=lambda o: -o["aminoAcids"])
    kept = []
    for idx, o in enumerate(out):
        nested = any(p["strand"] == o["strand"] and p["start"] <= o["start"] and p["end"] >= o["end"] for p in out[:idx])
        if not nested:
            kept.append(o)
    kept.sort(key=lambda o: o["start"])
    return kept


def auto_annotate(seq, existing=None, min_orf=75):
    """Library elements and ORFs that none of the existing features already cover."""
    out = []
    existing = existing or []

    def overlaps(s, e, strand, label=None):
        return any(
            f["start"] <= f["end"] and f["start"] <= e and f["end"] >= s + 1
            and (label is None or f["label"] == label) and f["strand"] == strand
            for f in existing + out
        )

    for m in FEATURE_LIBRARY:
        for strand in (1, -1):
            pat = m["seq"] if strand == 1 else reverse_complement(m["seq"])
            for p in find_pattern(seq, pat, False):
                start = p + 1
                end = p + len(m["seq"])
                if overlaps(start - 1, end, strand, m["label"]):
                    continue
                if overlaps(start - 1, end, strand) and m["type"] == "primer_bind":
                    continue
                out.append({"type": m["type"], "label": m["label"], "strand": strand, "start": start, "end": end,
                            "qualifiers": {"note": "Found by auto-annotation"}})
    for orf in find_orfs(seq, min_orf):
        start = orf["start"] + 1
        end = orf["end"]
        if overlaps(start - 1, end, orf["strand"]):
            continue
        piece = seq[orf["start"] : orf["end"]]
        protein = translate(piece if orf["strand"] == 1 else reverse_complement(piece))
        out.append({"type": "CDS", "label": f"ORF ({orf['aminoAcids']} aa)", "strand": orf["strand"],
                    "start": start, "end": end,
                    "qualifiers": {"note": "Open reading frame found by auto-annotation", "translation": protein}})
    out.sort(key=lambda f: f["start"])
    return out
