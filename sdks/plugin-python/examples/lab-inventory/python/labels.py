# Code 39: nine elements per character (bar, space, bar, …), three of them wide.
# "n" is narrow and "w" is wide; the characters are separated by a narrow space.
PATTERNS = {
    "0": "nnnwwnwnn", "1": "wnnwnnnnw", "2": "nnwwnnnnw", "3": "wnwwnnnnn",
    "4": "nnnwwnnnw", "5": "wnnwwnnnn", "6": "nnwwwnnnn", "7": "nnnwnnwnw",
    "8": "wnnwnnwnn", "9": "nnwwnnwnn", "A": "wnnnnwnnw", "B": "nnwnnwnnw",
    "C": "wnwnnwnnn", "D": "nnnnwwnnw", "E": "wnnnwwnnn", "F": "nnwnwwnnn",
    "G": "nnnnnwwnw", "H": "wnnnnwwnn", "I": "nnwnnwwnn", "J": "nnnnwwwnn",
    "K": "wnnnnnnww", "L": "nnwnnnnww", "M": "wnwnnnnwn", "N": "nnnnwnnww",
    "O": "wnnnwnnwn", "P": "nnwnwnnwn", "Q": "nnnnnnwww", "R": "wnnnnnwwn",
    "S": "nnwnnnwwn", "T": "nnnnwnwwn", "U": "wwnnnnnnw", "V": "nwwnnnnnw",
    "W": "wwwnnnnnn", "X": "nwnnwnnnw", "Y": "wwnnwnnnn", "Z": "nwwnwnnnn",
    "-": "nwnnnnwnw", ".": "wwnnnnwnn", " ": "nwwnnnwnn", "*": "nwnnwnwnn",
}


def code39_modules(input):
    """Answer with `modules`: a string of 1 (bar) and 0 (space), one per narrow width."""
    value = str(input["value"]).upper()
    bad = sorted({c for c in value if c not in PATTERNS or c == "*"})
    if bad:
        from sheetbase_plugin import PluginError

        raise PluginError("Code 39 cannot draw " + ", ".join(repr(c) for c in bad) + ".")
    bits = []
    for index, char in enumerate("*" + value + "*"):
        if index:
            bits.append("0")
        for element, width in enumerate(PATTERNS[char]):
            bits.append(("1" if element % 2 == 0 else "0") * (3 if width == "w" else 1))
    return {"modules": "".join(bits)}


def code39_value(input):
    """Turn what a scanner read into an ID: drop the * marks, upper-case it."""
    text = str(input["text"]).strip().strip("*").strip().upper()
    if not text or any(c not in PATTERNS or c == "*" for c in text):
        return {"value": None}
    return {"value": text}


def cryo_compact(input):
    record = input["record"]
    facts = record.get("facts") or {}
    second = " · ".join(part for part in (record.get("sampleType"), facts.get("lot")) if part)
    condition = facts.get("condition") or (record.get("properties") or {}).get("holdCondition")
    third = " · ".join(
        part
        for part in (
            condition,
            ("use by " + facts["useBy"]) if facts.get("useBy") else None,
        )
        if part
    )
    lines = [{"text": record["identifier"], "bold": True}]
    if second:
        lines.append({"text": second})
    if third:
        lines.append({"text": third})
    return {"lines": lines}
