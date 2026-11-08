from sheetbase_plugin import PluginError


def _records(text):
    name, parts = None, []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith(">"):
            if name is not None:
                yield name, "".join(parts)
            name, parts = line[1:].strip(), []
        elif name is None:
            raise PluginError("The file does not start with a > line, so it is not FASTA.")
        else:
            parts.append(line)
    if name is not None:
        yield name, "".join(parts)


def _gc(sequence):
    letters = [c for c in sequence.upper() if c.isalpha()]
    return round(100 * sum(c in "GC" for c in letters) / len(letters), 1) if letters else 0.0


def read_rows(content, filename):
    """An importer gets the file's text and its name and answers with rows."""
    rows = [
        {"name": name, "length": len(sequence), "sequence": sequence}
        for name, sequence in _records(content)
    ]
    if not rows:
        raise PluginError("No sequences were found in the file.")
    return rows


def write_file(rows, options):
    """An exporter gets the rows and its options and answers with the file's text."""
    width = int(options.get("width") or 60)
    out = []
    for index, row in enumerate(rows, start=1):
        sequence = str(row.get("sequence") or "")
        if not sequence:
            continue
        out.append(">" + str(row.get("name") or f"sequence-{index}"))
        out.extend(sequence[i : i + width] for i in range(0, len(sequence), width))
    if not out:
        raise PluginError("None of the rows has a sequence to write.")
    return "\n".join(out) + "\n"


def preview(content, filename):
    """A preview gets the file's text and its name and answers with a table or text."""
    rows = [
        {"name": name, "length": len(sequence), "gc_percent": _gc(sequence)}
        for name, sequence in _records(content)
    ]
    return {"kind": "table", "columns": ["name", "length", "gc_percent"], "rows": rows[:200]}


_COMPLEMENT = str.maketrans("ACGTUacgtu", "TGCAAtgcaa")


def sequence_key(values):
    """A same-thing rule answers with a key: equal keys mean the same thing."""
    letters = "".join(c for c in str(values["sequence"]).upper() if c.isalpha())
    if not letters:
        raise PluginError("The sequence has no letters.")
    letters = letters.replace("U", "T")
    reverse = letters.translate(_COMPLEMENT)[::-1]
    return {"key": min(letters, reverse)}
