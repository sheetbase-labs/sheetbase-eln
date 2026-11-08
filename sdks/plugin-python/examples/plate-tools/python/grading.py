import csv
import io

from sheetbase_plugin import ui


def _grade(value):
    if value is None:
        return None
    return "Pass" if value >= 90 else "Retest" if value >= 70 else "Fail"


def grade(rows):
    return [_grade(row.get("viability")) for row in rows]


def summarise(payload):
    counts = {}
    for label in grade(payload["rows"]):
        if label:
            counts[label] = counts.get(label, 0) + 1
    return {
        "view": ui.stack(
            ui.heading("Grades", level=3),
            ui.table(
                [{"key": "grade", "label": "Grade"}, {"key": "rows", "label": "Rows"}],
                [{"grade": name, "rows": n} for name, n in sorted(counts.items())],
            ),
        )
    }


def export_csv(payload):
    out = io.StringIO()
    rows = payload["rows"]
    names = sorted({key for row in rows for key in row})
    writer = csv.DictWriter(out, fieldnames=names)
    writer.writeheader()
    writer.writerows(rows)
    return {
        "download": {"filename": "chosen-rows.csv", "mime": "text/csv", "text": out.getvalue()},
        "notice": ui.notice(f"Exported {len(rows)} rows.", tone="success"),
    }


def inspect(payload):
    row = payload["rows"][0]
    return {
        "view": ui.stack(
            ui.heading(row.get("title") or "Row", level=3),
            ui.row(ui.badge(_grade(row.get("viability")) or "No grade", tone="info")),
            ui.stat("Viability", row.get("viability") if row.get("viability") is not None else "—", unit="%"),
        )
    }
