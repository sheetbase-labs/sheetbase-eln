# Chip and tag

A **chip** is an applied filter or a removable token. A **tag** marks a change in a diff.

- `Sheetbase.Chip` shows its label and a remove button; give `removeLabel` that names the object ("Remove filter: Updated in last 30 days"). Class `.chip`.
- `Sheetbase.Tag` with `kind` `add` | `chg` | `del`. Classes `.tag.add`, `.tag.chg`, `.tag.del`. Tags are for diffs and schema changes only, never for status (use Status).
- Keep chips to one row above the table they filter; "+ Add filter" follows the last chip.
