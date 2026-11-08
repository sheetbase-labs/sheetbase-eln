from sheetbase_plugin import PluginError


def master_mix(input):
    """A calculator gets its inputs as a dictionary and answers with its outputs."""
    reactions, per_reaction = input["reactions"], input["per_reaction"]
    overage = input.get("overage") or 0
    if reactions < 1 or per_reaction <= 0:
        raise PluginError("There must be at least one reaction with a volume above zero.")
    if overage < 0:
        raise PluginError("The extra cannot be negative.")
    per_with_extra = per_reaction * (1 + overage / 100)
    return {
        "total": round(per_with_extra * reactions, 3),
        "per_reaction_with_extra": round(per_with_extra, 3),
    }


def readings_present(table):
    """A check gets the bound columns as a DataFrame and answers pass, warn or fail."""
    values = table["reading"]
    missing = int(values.isna().sum())
    negative = int((values.dropna() < 0).sum())
    if missing or negative:
        parts = []
        if missing:
            parts.append(f"{missing} missing")
        if negative:
            parts.append(f"{negative} below zero")
        return {"status": "fail", "message": ", ".join(parts)}
    return {"status": "pass", "message": f"{len(values)} readings, all present"}


def subtract_blank(tables, settings):
    """A step gets its tables as DataFrames and its settings, and returns a table."""
    data = tables["readings"].copy()
    value, label = settings["value_column"], settings["label_column"]
    for name in (value, label):
        if name not in data.columns:
            raise PluginError(f"The table has no column called {name}.")
    blank_label = settings.get("blank_label") or "blank"
    blanks = data[data[label].astype(str).str.lower() == blank_label.lower()][value]
    if blanks.empty:
        raise PluginError(f"No rows are labelled {blank_label}.")
    offset = float(blanks.astype(float).mean())
    out = data[[label, value]].rename(columns={label: "label", value: "corrected"})
    out["corrected"] = out["corrected"].astype(float) - offset
    return out


def remind_on_release(input):
    """A reaction gets the event and answers with notes. It cannot change anything."""
    event = input["event"]
    return {
        "notes": [
            {
                "title": "A sample was released",
                "body": "Add it to the freezer log if it left cold storage.",
            }
        ]
    }
