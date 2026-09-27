# Stepper

Shows where a person is in a short, linear flow such as importing data (Upload, Map columns, Review and import).

- `Sheetbase.Stepper` with `steps` (list, or text separated by `|`), `current` (1-based) and `failed` for a step that needs attention. Classes `.stepper` with `.done`, `.now`, `.bad`.
- Three to five steps. Completed steps show a tick and stay clickable to go back; later steps are not links.
- Put the primary action for the step (Continue, Import 34 rows) at the top right of the page, not under the stepper.
