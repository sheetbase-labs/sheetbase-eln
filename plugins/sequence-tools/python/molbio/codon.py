"""Codon optimisation: re-write a coding sequence with the codons a host uses most, then
repair what that breaks (restriction sites to avoid, long single-base runs)."""
import math
import re

from .annotate import CODE
from .dna import find_pattern, reverse_complement
from .enzymes import enzyme_by_name

HOSTS = [
    {"key": "ecoli", "name": "E. coli K-12"},
    {"key": "human", "name": "Human"},
    {"key": "yeast", "name": "S. cerevisiae"},
]

_BASES = "TCAG"
CODON_LIST = [a + b + c for a in _BASES for b in _BASES for c in _BASES]

USAGE = {
    "ecoli": [
        22.1, 16.0, 14.3, 13.0, 10.4, 9.1, 8.9, 8.5, 17.5, 12.2, 2.0, 0.3, 5.2, 6.1,
        1.0, 13.9, 11.9, 10.2, 4.2, 48.4, 7.5, 5.4, 8.6, 20.9, 12.5, 9.3, 14.6,
        28.4, 20.0, 19.7, 3.8, 5.9, 29.8, 23.7, 6.8, 26.4, 10.3, 22.0, 9.3, 13.7,
        20.6, 21.4, 35.3, 12.4, 9.9, 15.2, 3.6, 2.1, 19.8, 14.3, 11.6, 24.4, 17.1,
        24.2, 21.2, 30.1, 32.7, 19.2, 39.1, 18.7, 25.5, 27.1, 9.5, 11.3,
    ],
    "human": [
        17.6, 20.3, 7.7, 12.9, 15.2, 17.7, 12.2, 4.4, 12.2, 15.3, 1.0, 0.8, 10.6,
        12.6, 1.6, 13.2, 13.2, 19.6, 7.2, 39.6, 17.5, 19.8, 16.9, 6.9, 10.9, 15.1,
        12.3, 34.2, 4.5, 10.4, 6.2, 11.4, 16.0, 20.8, 7.5, 22.0, 13.1, 18.9, 15.1,
        6.1, 17.0, 19.1, 24.4, 31.9, 12.1, 19.5, 12.2, 12.0, 11.0, 14.5, 7.1, 28.1,
        18.4, 27.7, 15.8, 7.4, 21.8, 25.1, 29.0, 39.6, 10.8, 22.2, 16.5, 16.5,
    ],
    "yeast": [
        26.1, 18.4, 26.2, 27.2, 23.5, 14.2, 18.7, 8.6, 18.8, 14.8, 1.1, 0.5, 8.1,
        4.8, 0.7, 10.4, 12.3, 5.4, 13.4, 10.5, 13.5, 6.8, 18.3, 5.3, 13.6, 7.8,
        27.3, 12.1, 6.4, 2.6, 3.0, 1.7, 30.1, 17.2, 17.8, 20.9, 20.3, 12.7, 17.8,
        8.0, 35.7, 24.8, 41.9, 30.8, 14.2, 9.8, 21.3, 9.2, 22.1, 11.8, 11.8, 10.8,
        21.2, 12.6, 16.2, 6.2, 37.6, 20.2, 45.6, 19.2, 23.9, 9.8, 10.9, 6.0,
    ],
}


def _weights(host):
    freq = {c: USAGE[host][i] for i, c in enumerate(CODON_LIST)}
    best = {}
    for c in CODON_LIST:
        best[CODE[c]] = max(best.get(CODE[c], 0), freq[c])
    return {c: freq[c] / best[CODE[c]] for c in CODON_LIST}


def codons_for(aa):
    return [c for c in CODON_LIST if CODE[c] == aa]


def translate_cds(dna):
    return "".join(CODE.get(dna[i : i + 3], "X") for i in range(0, len(dna) - len(dna) % 3, 3))


def adaptation_index(dna, host):
    w = _weights(host)
    total = 0.0
    n = 0
    for i in range(0, len(dna) - len(dna) % 3, 3):
        c = dna[i : i + 3]
        if CODE.get(c) == "*" or c in ("ATG", "TGG"):
            continue
        total += math.log(max(w.get(c, 0.01), 0.01))
        n += 1
    return 0 if n == 0 else math.exp(total / n)


class CodonError(ValueError):
    pass


def optimise_codons(dna=None, protein=None, host="ecoli", avoid_enzymes=None, max_run=None, add_stop=True):
    w = _weights(host)
    if protein is not None:
        prot = re.sub(r"[^A-Z*]", "", protein.upper())
    else:
        prot = translate_cds(dna)
    has_stop = prot.endswith("*")
    aas = list(prot[:-1] if has_stop else prot)
    choices = [sorted(codons_for(a), key=lambda c: -w[c]) for a in aas]
    if any(len(c) == 0 for c in choices):
        raise CodonError("The protein has a letter that is not an amino acid.")
    pick = [c[0] for c in choices]
    sites = []
    for nm in avoid_enzymes or []:
        e = enzyme_by_name(nm)
        if e is None:
            continue
        rc = reverse_complement(e["site"])
        sites.extend([e["site"]] if rc == e["site"] else [e["site"], rc])
    max_run = 6 if max_run is None else max_run

    def problems(seq):
        out = []
        for s in sites:
            for at in find_pattern(seq, s, False):
                out.append((at, f"site {s}"))
        if max_run > 0:
            for m in re.finditer(rf"([ACGT])\1{{{max_run - 1},}}", seq):
                for k in range(len(m.group(0)) - max_run + 1):
                    out.append((m.start() + k, f"run {m.group(0)}"))
        return out

    def build():
        return "".join(pick)

    out_dna = build()
    for _ in range(6):
        found = problems(out_dna)
        if not found:
            break
        improved = False
        for at, _what in found:
            first = max(0, at // 3 - 1)
            last_idx = min(len(pick) - 1, (at + 12) // 3)
            for i in range(first, last_idx + 1):
                before = len(problems(build()))
                current = pick[i]
                for alt in choices[i]:
                    if alt == current:
                        continue
                    pick[i] = alt
                    if len(problems(build())) < before:
                        improved = True
                        break
                    pick[i] = current
                if len(problems(build())) < before:
                    break
        out_dna = build()
        if not improved:
            break
    unresolved = [f"{what} at {at + 1}" for at, what in problems(out_dna)]
    if has_stop or add_stop:
        out_dna += "TGA" if host == "human" else "TAA"
    changed = 0
    cai_before = None
    if protein is None:
        src = re.sub(r"[^ACGT]", "", dna.upper())
        cai_before = adaptation_index(src, host)
        for i in range(len(pick)):
            if src[i * 3 : i * 3 + 3] != pick[i]:
                changed += 1
    gc = sum(1 for c in out_dna if c in "GC") / max(1, len(out_dna))
    return {
        "dna": out_dna,
        "protein": prot[:-1] if prot.endswith("*") else prot,
        "caiBefore": cai_before,
        "caiAfter": adaptation_index(out_dna, host),
        "gc": gc,
        "changed": changed,
        "unresolved": unresolved,
    }
