"""Pairwise alignment of DNA with affine gaps (Gotoh): global for two sequences that
should match end to end, local for a read against a larger reference. Big references
are cropped around the best k-mer diagonal first."""
from .dna import js_round, reverse_complement

DEFAULT_ALIGN = {"mode": "local", "match": 2, "mismatch": -3, "gapOpen": -5, "gapExtend": -2}

NEG = -1_000_000_000


def align_pair(a, b, options=None):
    o = {**DEFAULT_ALIGN, **(options or {})}
    A = a.upper()
    B = b.upper()
    n = len(A)
    m = len(B)
    local = o["mode"] == "local"
    gap_open = o["gapOpen"]
    gap_ext = o["gapExtend"]
    match = o["match"]
    mismatch = o["mismatch"]
    W = m + 1
    size = (n + 1) * W
    H = [0] * size
    E = [0] * size
    F = [0] * size
    # Traceback: H: 0 diag, 1 from E, 2 from F, 3 stop. E/F: 0 open, 1 extend.
    tH = bytearray(size)
    tE = bytearray(size)
    tF = bytearray(size)

    E[0] = NEG
    F[0] = NEG
    for j in range(1, m + 1):
        if local:
            H[j] = 0
            tH[j] = 3
        else:
            H[j] = gap_open + gap_ext * (j - 1)
            tH[j] = 1
        E[j] = H[j]
        tE[j] = 0 if j == 1 else 1
        F[j] = NEG
    for i in range(1, n + 1):
        k = i * W
        if local:
            H[k] = 0
            tH[k] = 3
        else:
            H[k] = gap_open + gap_ext * (i - 1)
            tH[k] = 2
        F[k] = H[k]
        tF[k] = 0 if i == 1 else 1
        E[k] = NEG

    best = 0
    bi = 0
    bj = 0
    for i in range(1, n + 1):
        ai = A[i - 1]
        base = i * W
        up = base - W
        for j in range(1, m + 1):
            k = base + j
            e_open = H[k - 1] + gap_open
            e_ext = E[k - 1] + gap_ext
            if e_ext > e_open:
                ek = e_ext
                tE[k] = 1
            else:
                ek = e_open
            E[k] = ek
            f_open = H[up + j] + gap_open
            f_ext = F[up + j] + gap_ext
            if f_ext > f_open:
                fk = f_ext
                tF[k] = 1
            else:
                fk = f_open
            F[k] = fk
            bj1 = B[j - 1]
            sub = match if (ai == bj1 or ai == "N" or bj1 == "N") else mismatch
            h = H[up + j - 1] + sub
            t = 0
            if ek > h:
                h = ek
                t = 1
            if fk > h:
                h = fk
                t = 2
            if local and h <= 0:
                h = 0
                t = 3
            H[k] = h
            tH[k] = t
            if local and h > best:
                best = h
                bi = i
                bj = j
    if not local:
        bi = n
        bj = m
        best = H[n * W + m]

    i = bi
    j = bj
    state = 0
    ra = []
    rb = []
    while i > 0 or j > 0:
        k = i * W + j
        if state == 0:
            t = tH[k]
            if t == 3:
                break
            if t == 0:
                ra.append(A[i - 1])
                rb.append(B[j - 1])
                i -= 1
                j -= 1
            else:
                state = t
        elif state == 1:
            ra.append("-")
            rb.append(B[j - 1])
            ext = tE[k] == 1
            j -= 1
            state = 1 if ext else 0
        else:
            ra.append(A[i - 1])
            rb.append("-")
            ext = tF[k] == 1
            i -= 1
            state = 2 if ext else 0
        if not local and i == 0 and j == 0:
            break
    aligned_a = "".join(reversed(ra))
    aligned_b = "".join(reversed(rb))
    matches = mismatches = gaps = 0
    for x, y in zip(aligned_a, aligned_b):
        if x == "-" or y == "-":
            gaps += 1
        elif x == y or x == "N" or y == "N":
            matches += 1
        else:
            mismatches += 1
    cols = len(aligned_a)
    return {
        "score": best,
        "aStart": i,
        "aEnd": bi,
        "bStart": j,
        "bEnd": bj,
        "alignedA": aligned_a,
        "alignedB": aligned_b,
        "matches": matches,
        "mismatches": mismatches,
        "gaps": gaps,
        "identity": 0 if cols == 0 else matches / cols,
    }


def _seed_window(ref, read, circular):
    k = 11
    if len(read) < k:
        return None
    text = ref + ref[: len(read)] if circular else ref
    index = {}
    for i in range(len(text) - k + 1):
        index.setdefault(text[i : i + k], []).append(i)
    votes = {}
    for i in range(len(read) - k + 1):
        hits = index.get(read[i : i + k])
        if not hits or len(hits) > 20:
            continue
        for p in hits:
            diag = js_round((p - i) / 64) * 64
            votes[diag] = votes.get(diag, 0) + 1
    best_diag = None
    best_votes = 0
    for d, v in votes.items():
        if v > best_votes:
            best_votes = v
            best_diag = d
    if best_diag is None or best_votes < 3:
        return None
    pad = 200
    return {"start": max(0, best_diag - pad), "end": min(len(text), best_diag + len(read) + pad)}


def align_read(template, read, circular, options=None):
    """Align a read to a template on whichever strand fits better (None when fewer than 20 bases match)."""
    ref = template.upper()
    n = len(ref)
    results = []
    for strand in (1, -1):
        q = read.upper() if strand == 1 else reverse_complement(read.upper())
        offset = 0
        window = ref
        if n * len(q) > 6_000_000:
            w = _seed_window(ref, q, circular)
            if not w:
                continue
            offset = w["start"]
            window = (ref + ref if circular else ref)[w["start"] : w["end"]]
        aln = align_pair(window, q, {**(options or {}), "mode": "local"})
        if aln["matches"] < 20:
            continue
        results.append({**aln, "strand": strand,
                        "refStart": (aln["aStart"] + offset) % n,
                        "refEnd": aln["aEnd"] + offset})
    if not results:
        return None
    results.sort(key=lambda r: -r["score"])
    return results[0]


def differences(aln, ref_offset=0, query_offset=0):
    """The mismatches, insertions and deletions between the aligned rows."""
    out = []
    r = aln["aStart"] + ref_offset
    q = aln["bStart"] + query_offset
    c = 0
    rows = len(aln["alignedA"])
    a_row = aln["alignedA"]
    b_row = aln["alignedB"]
    while c < rows:
        x = a_row[c]
        y = b_row[c]
        if x == "-":
            s = ""
            qp = q
            while c < rows and a_row[c] == "-":
                s += b_row[c]
                q += 1
                c += 1
            out.append({"kind": "insertion", "refPos": r, "queryPos": qp, "ref": "", "query": s})
            continue
        if y == "-":
            s = ""
            rp = r
            while c < rows and b_row[c] == "-":
                s += a_row[c]
                r += 1
                c += 1
            out.append({"kind": "deletion", "refPos": rp, "queryPos": q, "ref": s, "query": ""})
            continue
        if x != y and x != "N" and y != "N":
            out.append({"kind": "mismatch", "refPos": r, "queryPos": q, "ref": x, "query": y})
        r += 1
        q += 1
        c += 1
    return out
