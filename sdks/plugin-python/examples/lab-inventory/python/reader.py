import csv
import io

from sheetbase_plugin import PluginError


def read_rows(content, filename):
    """The file starts with lines about the run, then a header line, then one line per well."""
    lines = content.splitlines()
    start = next((i for i, line in enumerate(lines) if line.lower().startswith("well,")), None)
    if start is None:
        raise PluginError("This does not look like an Acme PlateReader file: there is no Well,… header line.")
    run = {}
    for line in lines[:start]:
        key, _, value = line.partition(":")
        if value:
            run[key.strip().lower()] = value.strip()
    rows = []
    for record in csv.DictReader(io.StringIO("\n".join(lines[start:]))):
        well = (record.get("Well") or "").strip()
        if not well:
            continue
        try:
            od = float(record.get("OD450") or "")
        except ValueError:
            od = None
        rows.append(
            {
                "well": well,
                "sample": (record.get("Sample") or "").strip(),
                "od450": od,
                "read_time": run.get("read time", ""),
            }
        )
    if not rows:
        raise PluginError("The file has a header but no wells.")
    return rows
