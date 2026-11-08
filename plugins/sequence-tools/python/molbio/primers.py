"""Primer design in the manner of Primer3: nearest-neighbour melting temperature
(SantaLucia 1998), GC and clamp rules, hairpin and dimer checks, a penalty score,
and pair selection for a target region."""
import math
import re

from .dna import find_pattern, gc_fraction, js_round, reverse_complement

R = 1.987  # cal / (mol K)

# [dH kcal/mol, dS cal/(mol K)] for each dinucleotide, top-strand reading.
NN = {
    "AA": (-7.9, -22.2), "TT": (-7.9, -22.2), "AT": (-7.2, -20.4), "TA": (-7.2, -21.3),
    "CA": (-8.5, -22.7), "TG": (-8.5, -22.7), "GT": (-8.4, -22.4), "AC": (-8.4, -22.4),
    "CT": (-7.8, -21.0), "AG": (-7.8, -21.0), "GA": (-8.2, -22.2), "TC": (-8.2, -22.2),
    "CG": (-10.6, -27.2), "GC": (-9.8, -24.4), "GG": (-8.0, -19.9), "CC": (-8.0, -19.9),
}

DEFAULT_CONDITIONS = {"na": 50, "mg": 1.5, "dntp": 0.6, "oligo": 500}


def _sodium_equivalent(c):
    free = max(c["mg"] - c["dntp"], 0)
    return c["na"] + 120 * math.sqrt(free)


def melting_temp(seq, conditions=DEFAULT_CONDITIONS):
    """Melting temperature in °C. Ambiguous bases are not allowed here."""
    s = seq.upper()
    if len(s) < 2:
        return 0
    d_h = 0.0
    d_s = 0.0
    for i in range(len(s) - 1):
        p = NN.get(s[i : i + 2])
        if not p:
            return 0
        d_h += p[0]
        d_s += p[1]
    for end in (s[0], s[-1]):
        if end in "GC":
            d_h += 0.1
            d_s += -2.8
        else:
            d_h += 2.3
            d_s += 4.1
    self_comp = s == reverse_complement(s)
    if self_comp:
        d_s += -1.4
    ct = (conditions["oligo"] * 1e-9) / (1 if self_comp else 4)
    tm = (d_h * 1000) / (d_s + R * math.log(ct)) - 273.15
    na = _sodium_equivalent(conditions) / 1000
    f = 0.368 * (len(s) - 1) * math.log(na)
    corrected = (d_h * 1000) / (d_s + f + R * math.log(ct)) - 273.15
    return js_round((tm if na == 0.05 else corrected) * 10) / 10


def duplex_delta_g(seq):
    s = seq.upper()
    d_h = 0.0
    d_s = 0.0
    for i in range(len(s) - 1):
        p = NN.get(s[i : i + 2])
        if not p:
            return 0
        d_h += p[0]
        d_s += p[1]
    return d_h - (310.15 * d_s) / 1000


def dimer_check(a, b):
    """Best ungapped pairing of a with the reverse complement of b."""
    A = a.upper()
    brc = reverse_complement(b.upper())
    best = {"deltaG": 0, "run": 0, "threePrime": False}
    la = len(A)
    lb = len(brc)
    for shift in range(-(lb - 1), la):
        run_start = -1
        for i in range(la + 1):
            j = i - shift
            pair = i < la and 0 <= j < lb and A[i] == brc[j]
            if pair:
                if run_start < 0:
                    run_start = i
            elif run_start >= 0:
                length = i - run_start
                if length >= 3:
                    dg = duplex_delta_g(A[run_start:i])
                    three = i == la
                    if dg < best["deltaG"] or (dg == best["deltaG"] and three):
                        best = {
                            "deltaG": js_round(dg * 100) / 100,
                            "run": max(best["run"], length),
                            "threePrime": best["threePrime"] or three,
                        }
                    else:
                        best["run"] = max(best["run"], length)
                    if three and dg < -3:
                        best["threePrime"] = True
                run_start = -1
    return best


_COMP = {"A": "T", "T": "A", "G": "C", "C": "G"}


def hairpin_check(seq):
    """Strongest hairpin: a stem of at least three pairs around a loop of 3+."""
    s = seq.upper()
    n = len(s)
    best = {"deltaG": 0, "stem": 0}
    for i in range(n):
        for j in range(i + 4, n):
            a = i
            b = j
            while a >= 0 and b < n and _COMP.get(s[a]) == s[b]:
                a -= 1
                b += 1
            stem = i - a
            if stem >= 3:
                dg = duplex_delta_g(s[a + 1 : i + 1]) + 3.5
                if dg < best["deltaG"]:
                    best = {"deltaG": js_round(dg * 100) / 100, "stem": stem}
    return best


def longest_repeat(seq):
    best = 0
    run = 0
    for i in range(len(seq)):
        run = run + 1 if i > 0 and seq[i] == seq[i - 1] else 1
        best = max(best, run)
    return best


PRIMER_LIMITS = {"hairpinDeltaG": -2, "dimerDeltaG": -6, "threePrimeDimerDeltaG": -4}


def analyse_primer(seq, conditions=DEFAULT_CONDITIONS):
    s = re.sub(r"[^ACGT]", "", seq.upper())
    hairpin = hairpin_check(s)
    self_dimer = dimer_check(s, s)
    tail = s[-5:]
    gc_clamp = sum(1 for c in tail if c in "GC")
    report = {
        "seq": s,
        "length": len(s),
        "tm": melting_temp(s, conditions),
        "gc": js_round(gc_fraction(s) * 1000) / 10,
        "gcClamp": gc_clamp,
        "maxRepeat": longest_repeat(s),
        "hairpin": hairpin,
        "selfDimer": self_dimer,
        "warnings": [],
    }
    w = report["warnings"]
    if len(s) < 15:
        w.append("short")
    if len(s) > 35:
        w.append("long")
    if report["gc"] < 35 or report["gc"] > 65:
        w.append("gc")
    if gc_clamp == 0:
        w.append("weakClamp")
    if gc_clamp > 3:
        w.append("strongClamp")
    if report["maxRepeat"] >= 5:
        w.append("repeat")
    if hairpin["deltaG"] < PRIMER_LIMITS["hairpinDeltaG"]:
        w.append("hairpin")
    if self_dimer["deltaG"] < PRIMER_LIMITS["dimerDeltaG"] or (
        self_dimer["threePrime"] and self_dimer["deltaG"] < PRIMER_LIMITS["threePrimeDimerDeltaG"]
    ):
        w.append("selfDimer")
    return report


def find_binding_sites(template, primer, circular, min_paired=None):
    """Where a primer's 3' end pairs with a template (needs 15 paired 3' bases by default)."""
    p = primer.upper()
    min_paired = min(15 if min_paired is None else min_paired, len(p))
    seed_len = min_paired
    seed = p[-seed_len:] if seed_len > 0 else ""
    n = len(template)
    out = []
    for strand in (1, -1):
        t = template if strand == 1 else reverse_complement(template)
        for h in find_pattern(t, seed, circular):
            ext = 0
            lead = len(p) - seed_len
            while ext < lead:
                ti = (h - 1 - ext) % n if circular else h - 1 - ext
                if ti < 0 or t[ti] != p[lead - 1 - ext]:
                    break
                ext += 1
            paired = seed_len + ext
            tail = len(p) - paired
            start = h - ext if strand == 1 else n - h - seed_len
            end = h + seed_len if strand == 1 else n - h + ext
            out.append({
                "strand": strand,
                "paired": paired,
                "tail": tail,
                "start": start % n if circular else start,
                "end": (end - 1) % n + 1 if circular else end,
            })
    return out


def simulate_pcr(template, forward, reverse, circular, max_size=20000):
    """Every product between a forward-binding and a reverse-binding primer, tails included."""
    n = len(template)
    t = template.upper()
    fw = forward.upper()
    rv = reverse.upper()
    f_sites = [s for s in find_binding_sites(t, fw, circular) if s["strand"] == 1]
    r_sites = [s for s in find_binding_sites(t, rv, circular) if s["strand"] == -1]
    out = []
    for f in f_sites:
        for r in r_sites:
            span = r["end"] - f["start"]
            if circular and span <= 0:
                span += n
            if span <= 0:
                continue
            body = (t + t)[f["start"] : f["start"] + span] if circular else t[f["start"] : r["end"]]
            seq = fw[: f["tail"]] + body + reverse_complement(rv[: r["tail"]])
            if len(seq) > max_size:
                continue
            out.append({"start": f["start"], "end": r["end"], "size": len(seq), "seq": seq})
    out.sort(key=lambda p: p["size"])
    return out


DEFAULT_DESIGN = {
    "minLen": 18, "optLen": 20, "maxLen": 27,
    "minTm": 57, "optTm": 60, "maxTm": 63,
    "minGc": 40, "maxGc": 60, "maxTmDiff": 3,
    "minProduct": 100, "maxProduct": 2000,
    "requireClamp": True, "conditions": DEFAULT_CONDITIONS, "count": 5,
}


def _penalty_for(r, o):
    p = abs(r["tm"] - o["optTm"]) * 1.0
    if r["tm"] < o["minTm"]:
        p += (o["minTm"] - r["tm"]) * 3
    if r["tm"] > o["maxTm"]:
        p += (r["tm"] - o["maxTm"]) * 3
    p += abs(r["length"] - o["optLen"]) * 0.25
    p += abs(r["gc"] - 50) * 0.05
    p += len(r["warnings"]) * 2
    if r["hairpin"]["deltaG"] < 0:
        p += -r["hairpin"]["deltaG"] * 0.5
    if r["selfDimer"]["deltaG"] < 0:
        p += -r["selfDimer"]["deltaG"] * 0.3
    return js_round(p * 100) / 100


def _candidates_at(template, anchor, strand, o, window):
    out = []
    n = len(template)
    for length in range(o["minLen"], o["maxLen"] + 1):
        for shift in range(window + 1):
            if strand == 1:
                start = anchor + shift
                end = start + length
                if start < 0 or end > n:
                    continue
                seq = template[start:end]
            else:
                end = anchor - shift
                start = end - length
                if start < 0 or end > n:
                    continue
                seq = reverse_complement(template[start:end])
            if re.search(r"[^ACGT]", seq):
                continue
            r = analyse_primer(seq, o["conditions"])
            if r["tm"] < o["minTm"] - 4 or r["tm"] > o["maxTm"] + 4:
                continue
            if r["gc"] < o["minGc"] - 5 or r["gc"] > o["maxGc"] + 5:
                continue
            if o["requireClamp"] and r["gcClamp"] == 0:
                continue
            if r["maxRepeat"] >= 5:
                continue
            out.append({**r, "start": start, "end": end, "strand": strand,
                        "penalty": _penalty_for(r, o)})
    out.sort(key=lambda c: c["penalty"])
    return out[:40]


def design_primers(template, target, options=None, flank=0):
    """Design primer pairs that amplify target (0-based, end exclusive) of the template."""
    o = {**DEFAULT_DESIGN, **(options or {})}
    t = template.upper()
    fwd_anchor = target["start"] - flank
    rev_anchor = target["end"] + flank
    window = max(flank, 30)
    fwd = _candidates_at(t, max(0, fwd_anchor), 1, o, window)
    rev = _candidates_at(t, min(len(t), rev_anchor), -1, o, window)
    pairs = []
    for f in fwd:
        for r in rev:
            size = r["end"] - f["start"]
            if size < o["minProduct"] or size > o["maxProduct"]:
                continue
            if flank == 0 and (f["start"] < target["start"] or r["end"] > target["end"]):
                continue
            tm_diff = abs(f["tm"] - r["tm"])
            if tm_diff > o["maxTmDiff"]:
                continue
            pair_dimer = dimer_check(f["seq"], r["seq"])
            warnings = []
            if pair_dimer["deltaG"] < PRIMER_LIMITS["dimerDeltaG"] or (
                pair_dimer["threePrime"]
                and pair_dimer["deltaG"] < PRIMER_LIMITS["threePrimeDimerDeltaG"]
            ):
                warnings.append("pairDimer")
            penalty = (
                f["penalty"] + r["penalty"] + tm_diff * 1.5
                + (-pair_dimer["deltaG"] * 0.4 if pair_dimer["deltaG"] < 0 else 0)
                + len(warnings) * 5
            )
            pairs.append({
                "forward": f, "reverse": r, "productSize": size,
                "tmDiff": js_round(tm_diff * 10) / 10,
                "pairDimer": pair_dimer,
                "penalty": js_round(penalty * 100) / 100,
                "warnings": warnings,
            })
    pairs.sort(key=lambda p: p["penalty"])
    seen = set()
    picked = []
    for p in pairs:
        if p["forward"]["seq"] in seen:
            continue
        seen.add(p["forward"]["seq"])
        picked.append(p)
        if len(picked) >= o["count"]:
            break
    return picked
