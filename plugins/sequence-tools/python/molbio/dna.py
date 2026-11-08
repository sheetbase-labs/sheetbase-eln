"""Small DNA helpers: cleaning input, IUPAC matching and slicing around the origin of a circle."""
import math
import re

COMPLEMENT = {
    "A": "T", "T": "A", "G": "C", "C": "G", "U": "A", "N": "N",
    "R": "Y", "Y": "R", "K": "M", "M": "K", "S": "S", "W": "W",
    "B": "V", "V": "B", "D": "H", "H": "D",
}

IUPAC = {
    "A": "A", "C": "C", "G": "G", "T": "T", "R": "AG", "Y": "CT", "K": "GT",
    "M": "AC", "S": "CG", "W": "AT", "B": "CGT", "D": "AGT", "H": "ACT",
    "V": "ACG", "N": "ACGT",
}

_NOT_DNA = re.compile(r"[^ACGTRYKMSWBDHVN]")


def js_round(x):
    """Math.round: halves go up, so the numbers match the TypeScript exactly."""
    return math.floor(x + 0.5)


def js_num(x):
    """A whole-valued float as an int, the way JSON from JavaScript shows it."""
    if isinstance(x, float) and x.is_integer() and abs(x) < 1e15:
        return int(x)
    return x


def reverse_complement(seq):
    out = []
    for ch in reversed(seq):
        up = ch.upper()
        c = COMPLEMENT.get(up, up)
        out.append(c if ch == up else c.lower())
    return "".join(out)


def clean_dna(text):
    """Upper-case DNA letters only (RNA U becomes T); whitespace and digits go."""
    return _NOT_DNA.sub("", text.upper().replace("U", "T"))


def clean_input(raw):
    """Like clean_dna, but a FASTA header line (starting with >) is a name, not bases."""
    body = "".join(line for line in raw.split("\n") if not line.strip().startswith(">"))
    return clean_dna(body)


_PATTERNS = {}


def _compile(pattern):
    found = _PATTERNS.get(pattern)
    if found is None:
        parts = []
        for ch in pattern:
            members = IUPAC.get(ch)
            parts.append("[" + members + "]" if members else "[^\\s\\S]")
        found = re.compile("(?=" + "".join(parts) + ")")
        _PATTERNS[pattern] = found
    return found


def find_pattern(seq, pattern, circular):
    """Positions (0-based) where an IUPAC pattern matches the forward strand."""
    n = len(seq)
    m = len(pattern)
    if m == 0 or n == 0 or (not circular and n < m) or (circular and m > n):
        return []
    hay = seq + seq[: m - 1] if circular else seq
    return [hit.start() for hit in _compile(pattern).finditer(hay)]


def gc_fraction(seq):
    if not seq:
        return 0
    return sum(1 for ch in seq if ch in "GC") / len(seq)


def mod(a, n):
    return a % n
