from sheetbase_plugin import PluginError


def viability(input):
    live, dead = input["live"], input["dead"]
    if live < 0 or dead < 0:
        raise PluginError("Counts cannot be negative.")
    total = live + dead
    if total == 0:
        raise PluginError("Count at least one cell.")
    return {"viability": round(100 * live / total, 1), "total": total}


def seeding_volume(input):
    if input["live_per_ml"] <= 0:
        raise PluginError("The culture has no live cells to seed from.")
    per_well = input["cells_per_well"] / input["live_per_ml"]
    return {
        "ml_per_well": round(per_well, 4),
        "ml_total": round(per_well * input["wells"], 4),
    }
