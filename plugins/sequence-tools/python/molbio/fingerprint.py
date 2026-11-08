"""One form for a sequence however it was written down, and its registry fingerprint.

The fingerprint is the ``seq:<sha256>`` text registries already hold: upper case,
bases only, the same from either strand, and for a circle the same from any start.
Registered sequences keep matching because this gives the same text as the app did.
"""
import hashlib
import re

from .dna import reverse_complement


def least_rotation(s):
    """The least rotation of a string (Booth's algorithm), in linear time."""
    n = len(s)
    if n < 2:
        return s
    doubled = s + s
    failure = [-1] * (2 * n)
    k = 0
    for j in range(1, 2 * n):
        c = doubled[j]
        i = failure[j - k - 1]
        while i != -1 and c != doubled[k + i + 1]:
            if c < doubled[k + i + 1]:
                k = j - i - 1
            i = failure[i]
        if c != doubled[k + i + 1]:
            if c < doubled[k]:
                k = j
            failure[j - k] = -1
        else:
            failure[j - k] = i + 1
    return s[k:] + s[:k]


def canonical_sequence(residues, molecule="dna", topology="linear"):
    seq = re.sub(r"[^A-Z*]", "", residues.upper())
    if molecule == "protein":
        return seq
    dna = seq.replace("U", "T") if molecule == "rna" else seq
    forward = least_rotation(dna) if topology == "circular" else dna
    rc = reverse_complement(dna)
    reverse = least_rotation(rc) if topology == "circular" else rc
    return forward if forward <= reverse else reverse


def sequence_fingerprint(residues, molecule="dna", topology="linear"):
    canon = canonical_sequence(residues, molecule, topology)
    return "seq:" + hashlib.sha256(canon.encode("utf-8")).hexdigest()


def sequence_key_from(values):
    """A registry entry's key from its values: the fingerprint it already holds, else one made from its sequence."""
    held = (values.get("sequence_fingerprint") or "").strip()
    if held.startswith("seq:"):
        return held
    residues = values.get("sequence")
    if not residues or not isinstance(residues, str):
        return None
    return sequence_fingerprint(residues, values.get("molecule") or "dna", values.get("topology") or "linear")
