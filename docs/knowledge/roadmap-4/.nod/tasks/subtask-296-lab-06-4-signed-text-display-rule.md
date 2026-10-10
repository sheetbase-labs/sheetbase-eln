---
id: subtask-296
title: LAB-06.4 — Signed text display rule
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-09-27"
parent: task-292
tags:
  - LAB-06.4
  - LAB
---

# LAB-06.4 — Signed text display rule

Step 4 of 5 in [LAB-06](../../tasks/LAB.md#lab-06--instruments-identity-calibration-and-qualification); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: done. The earlier note that no structure records an instrument name was right about the *evidence*, but wrong about the *association*: api.dataset_imports names both the experiment record and the instrument the data came through, so a record's instruments are the ones its committed imports came through - not a new link invented for this, and deliberately not the project's instrument runs, which would attribute an unrelated run to the record. drizzle/0420 adds internal.record_instrument_evidence, returning the identity, display id and name of each such instrument, and joins it to the revision envelope as an instruments section. The envelope is what a revision freezes (metadata_snapshot is its record section, canonical_snapshot is the whole envelope), so the names land in frozen evidence without a second snapshot to keep in step; existing revisions keep the envelope they were signed with. Only the identity and the name are captured - the current name is read live at comparison time, which is what makes a rename visible rather than silently applied to history. drizzle/0421 extends api.revision_drift (REV-04.1, the named consumer) with an instruments array comparing signedName against currentName and reporting renamed, and folds it into drifted. The evidence page renders the pair, showing the signed name with the current one beside it when they differ. Verified in tests/db/revision-drift.test.ts (8 tests): the capture puts a committed import's instrument name into the envelope; a rename reports both names and marks drift; an unchanged name reports no drift; and a revision frozen before the capture existed reports no instruments rather than guessing. Unit suite 390 files / 4044 tests; typecheck clean.
  - 2026-10-10: NOT implementable as a display rule; stays open with a precise finding. No evidence structure records an instrument name, so there is no captured name to render beside the current one. internal.build_revision_envelope freezes record, blocks, record_links (targetIdentifier is a record), scientificTables, formulas and files - no instrument column and no join to api.instruments. api.revision_evidence_package and api.revision_sheet_evidence carry instance_state, composed_grid and dataset_versions only. A reference field freezes reference_id (a uuid), never a display name, and although 'instrument' is a valid model key so a dataset reference *can* target an instrument, only the uuid is frozen. Instruments are not api.records and record_links.link_type excludes instrument, so an instrument cannot be referenced as evidence at all. Instrument names appear only live (api.sample_measurement_provenance joins api.instruments at read time for the sample Measurements tab; api.dataset_imports.instrument_id is a live FK), and the only durable trace of past names is the workspace-wide change-event log behind api.instrument_history, which is not part of the evidence package. The design expects an 'Instrument name | Turbidimeter 2 | Turbidimeter TB-02' row (screen-text/EvidenceCompare.txt) and a signed record showing the name used when signed with the current name beside it (screen-text/RecordInstrument.txt); neither value exists in any frozen artifact. Closing this needs a decision about capturing the instrument name (and its identifier) into the revision envelope or the sheet evidence at signing - a model change, not a display rule. Nothing was invented and no migration was written.
