"""Common restriction enzymes: name, site (IUPAC), top and bottom cut offsets."""

_ROWS = [
    ("EcoRI", "GAATTC", 1, 5), ("BamHI", "GGATCC", 1, 5), ("HindIII", "AAGCTT", 1, 5),
    ("NotI", "GCGGCCGC", 2, 6), ("XhoI", "CTCGAG", 1, 5), ("XbaI", "TCTAGA", 1, 5),
    ("SpeI", "ACTAGT", 1, 5), ("NcoI", "CCATGG", 1, 5), ("NdeI", "CATATG", 2, 4),
    ("NheI", "GCTAGC", 1, 5), ("SalI", "GTCGAC", 1, 5), ("KpnI", "GGTACC", 5, 1),
    ("SacI", "GAGCTC", 5, 1), ("SacII", "CCGCGG", 4, 2), ("PstI", "CTGCAG", 5, 1),
    ("SphI", "GCATGC", 5, 1), ("ApaI", "GGGCCC", 5, 1), ("SmaI", "CCCGGG", 3, 3),
    ("XmaI", "CCCGGG", 1, 5), ("EcoRV", "GATATC", 3, 3), ("PvuII", "CAGCTG", 3, 3),
    ("HpaI", "GTTAAC", 3, 3), ("ScaI", "AGTACT", 3, 3), ("StuI", "AGGCCT", 3, 3),
    ("SwaI", "ATTTAAAT", 4, 4), ("PmeI", "GTTTAAAC", 4, 4), ("AscI", "GGCGCGCC", 2, 6),
    ("PacI", "TTAATTAA", 5, 3), ("FseI", "GGCCGGCC", 6, 2), ("SbfI", "CCTGCAGG", 6, 2),
    ("BglII", "AGATCT", 1, 5), ("ClaI", "ATCGAT", 2, 4), ("MluI", "ACGCGT", 1, 5),
    ("AgeI", "ACCGGT", 1, 5), ("BsrGI", "TGTACA", 1, 5), ("NsiI", "ATGCAT", 5, 1),
    ("BspEI", "TCCGGA", 1, 5), ("AvrII", "CCTAGG", 1, 5), ("EagI", "CGGCCG", 1, 5),
    ("BclI", "TGATCA", 1, 5), ("BstBI", "TTCGAA", 2, 4), ("PvuI", "CGATCG", 4, 2),
    ("SnaBI", "TACGTA", 3, 3), ("DraI", "TTTAAA", 3, 3), ("AatII", "GACGTC", 5, 1),
    ("AflII", "CTTAAG", 1, 5), ("ApaLI", "GTGCAC", 1, 5), ("BsiWI", "CGTACG", 1, 5),
    ("BspHI", "TCATGA", 1, 5), ("BssHII", "GCGCGC", 1, 5), ("MfeI", "CAATTG", 1, 5),
    ("NaeI", "GCCGGC", 3, 3), ("NarI", "GGCGCC", 2, 4), ("HaeIII", "GGCC", 2, 2),
    ("AluI", "AGCT", 2, 2), ("MspI", "CCGG", 1, 3), ("TaqI", "TCGA", 1, 3),
    ("Sau3AI", "GATC", 0, 4), ("NlaIII", "CATG", 4, 0), ("BfaI", "CTAG", 1, 3),
    ("XmnI", "GAANNNNTTC", 5, 5), ("BglI", "GCCNNNNNGGC", 7, 4),
    ("SfiI", "GGCCNNNNNGGCC", 8, 5), ("AlwNI", "CAGNNNCTG", 6, 3),
    ("DraIII", "CACNNNGTG", 6, 3), ("BstXI", "CCANNNNNNTGG", 8, 4),
    ("PflMI", "CCANNNNNTGG", 7, 4), ("AflIII", "ACRYGT", 1, 5),
    ("BsaI", "GGTCTC", 7, 11), ("BsmBI", "CGTCTC", 7, 11), ("Esp3I", "CGTCTC", 7, 11),
    ("BbsI", "GAAGAC", 8, 12), ("SapI", "GCTCTTC", 8, 11), ("PaqCI", "CACCTGC", 11, 15),
    ("FokI", "GGATG", 14, 18), ("BsrI", "ACTGG", 6, 4), ("BpmI", "CTGGAG", 22, 20),
    ("MmeI", "TCCRAC", 26, 24), ("BseRI", "GAGGAG", 16, 14),
]

ENZYMES = [{"name": n, "site": s, "top": t, "bottom": b} for n, s, t, b in _ROWS]
_BY_NAME = {e["name"].lower(): e for e in ENZYMES}


def enzyme_by_name(name):
    return _BY_NAME.get(name.strip().lower())
