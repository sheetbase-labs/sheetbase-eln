"""The plugin's operation: results analysis on rows sent in a call."""
from sheetbase_plugin import PluginError

import results_analysis


def _summary(rows):
    lines = []
    for row in rows:
        kind = row.get("kind")
        if kind == "result":
            if row["status"] == "fitted":
                lines.append(
                    f"{row['group']}: EC50 {row['ec50']} (95% CI {row['ec50_low']} to {row['ec50_high']}), "
                    f"slope {row['hill']}, bottom {row['bottom']}, top {row['top']}, R² {row['r2']}."
                )
            else:
                lines.append(f"{row['group']}: {row['status']}.")
        elif kind == "curve":
            lines.append(f"Standard curve ({row['model']}): R² {row['r2']} from {row['standards']} standards covering {row['range']}.")
        elif kind == "sample":
            lines.append(f"{row['name']}: signal {row['signal']}, concentration {row['concentration']} ({row['in_range']}).")
        elif kind == "group":
            lines.append(f"{row['name']}: n={row['n']}, mean {row['mean']}, SD {row['sd']}.")
        elif kind == "test":
            lines.append(f"{row['test']} {row['name']}: p = {row['p_value']}.")
    return "\n".join(lines)


def analyse(input):
    rows = input.get("rows")
    if not isinstance(rows, list) or not all(isinstance(r, dict) for r in rows):
        raise PluginError("Send rows as a list of objects, one per row of the table.")
    settings = {
        "kind": input.get("kind"),
        "x": input.get("x"),
        "y": input.get("y"),
        "group": input.get("group"),
        "label": input.get("label"),
        "model": input.get("model"),
        "unit": input.get("unit"),
    }
    try:
        out = results_analysis.run(rows, settings)
    except ValueError as error:
        raise PluginError(str(error))
    figures = [
        {"title": row["title"], "image": row[results_analysis.FIGURE_FIELD]}
        for row in out
        if row.get("kind") == "figure"
    ]
    table = [row for row in out if row.get("kind") != "figure"]
    return {"results": table, "figures": figures, "summary": _summary(table)}
