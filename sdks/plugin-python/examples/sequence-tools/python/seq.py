from sheetbase_plugin import PluginError

BASES = "ACGTN"


def analyse(input):
    sequence = "".join(input["sequence"].split()).upper()
    if not sequence:
        raise PluginError("Give at least one base.")
    unknown = sorted(set(sequence) - set(BASES))
    if unknown:
        raise PluginError("Not a DNA letter: " + ", ".join(unknown))
    counts = {base: sequence.count(base) for base in BASES}
    gc = 100 * (counts["G"] + counts["C"]) / len(sequence)
    return {"length": len(sequence), "gc": round(gc, 1), "counts": counts}
