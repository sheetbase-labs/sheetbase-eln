# Display identifiers

**Status (2026-09-28):** open data-model gap found by DSYS-05.4.

The design screens label objects with human display identifiers that the data
model does not store yet. The seed can reproduce every stored identifier family
(`EXP-`, `SMP-`, `PRT-`, `MAT-`, coverage 394/394), but these families have no
column:

| Family                                                                        | Design use                                   | Owning task           |
| ----------------------------------------------------------------------------- | -------------------------------------------- | --------------------- |
| `DS-nnnn`                                                                     | dataset header (`DS-0298`, `DS-0311`)        | DSET (datasets)       |
| `PL-nnnn`                                                                     | pipeline list/runs (`PL-0007`)               | AUTO (pipelines)      |
| `SHT-nnnn`                                                                    | working sheets (`SHT-0019`)                  | SHEET (sheets)        |
| `MDL-nnnn`                                                                    | models (`MDL-0012`)                          | MDL (models)          |
| `CAL-nnnn`                                                                    | calendar bookings (`CAL-0913`)               | WORK-04 (schedule)    |
| `CL-nnnn`                                                                     | client accounts (`CL-017`)                   | PORTAL (client users) |
| `PRJ-nnnn`                                                                    | projects — planned by PROJ-01.1              | PROJ-01.1             |
| `CB-nnnn`                                                                     | cell banks                                   | LAB (cell banks)      |
| `INS-nnnn`                                                                    | instruments                                  | LAB-06 (instruments)  |
| `AN-nnnn`                                                                     | analyses                                     | Analysis stream       |
| `TPL-nnnn`                                                                    | notebook templates                           | SHEET/REUSE           |
| `HL-nnnn`                                                                     | harvest lots                                 | LAB (samples)         |
| `LT-nn`, `TB-nn`, `PR-nn`, `EM-…`, `MSA-…`, `QC-…`, `SIG-…`, `SOW-…`, `AMB-…` | fixtures, plates, media, samples, signatures | their owning tasks    |

## Rule

Do not fake a display identifier by embedding it in a title or name. When a
task builds its object, it adds a stable per-workspace display id column
(generated on create, immutable, never reused) and the seed sets the design's
value. Until then the identifier appears only in the design copy.

`pnpm design:coverage` reports these families separately from the stored ones
so the gap stays visible without masking real seed misses.
