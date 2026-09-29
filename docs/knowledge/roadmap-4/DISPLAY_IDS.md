# Display identifiers

**Status (2026-09-29):** open data-model gap found by DSYS-05.4. The UI port
resolved `MDL-`, `TPL-`, `SHT-` and `AN-` (models, notebook templates, working
sheets, saved analyses); the rest remain.

The design screens label objects with human display identifiers that the data
model does not store yet. The seed reproduces every stored family (`EXP-`,
`SMP-`, `PRT-`, `MAT-`, `DS-`, `PL-`, `CAL-`, `INS-`, `PRJ-`, `CL-`), but
these families have no column:

| Family                                                                        | Design use                                   | Owning task        |
| ----------------------------------------------------------------------------- | -------------------------------------------- | ------------------ |
| `CB-nnnn`                                                                     | cell banks                                   | LAB (cell banks)   |
| `HL-nnnn`                                                                     | harvest lots                                 | LAB (samples)      |
| `LT-nn`, `TB-nn`, `PR-nn`, `EM-…`, `MSA-…`, `QC-…`, `SIG-…`, `SOW-…`, `AMB-…` | fixtures, plates, media, samples, signatures | their owning tasks |

Resolved: `DS-`, `PL-`, `CAL-`, `INS-` (earlier tasks); `PRJ-` and `CL-`
(PROJ-01.1 — `api.projects.display_id`, `api.clients.code`); `MDL-`, `TPL-`,
`SHT-` and `AN-` (UI port — `api.dataset_schema_definitions.display_id`,
`api.notebook_templates.display_id`, `api.sheet_instances.display_id`,
`api.analysis_views.display_id`).

## Rule

Do not fake a display identifier by embedding it in a title or name. When a
task builds its object, it adds a stable per-workspace display id column
(generated on create, immutable, never reused) and the seed sets the design's
value. Until then the identifier appears only in the design copy.

`pnpm design:coverage` reports these families separately from the stored ones
so the gap stays visible without masking real seed misses.
