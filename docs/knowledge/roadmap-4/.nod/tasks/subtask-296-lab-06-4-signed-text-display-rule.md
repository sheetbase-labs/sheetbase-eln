---
id: subtask-296
title: LAB-06.4 — Signed text display rule
type: subtask
status: todo
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
  - 2026-10-10: NOT implementable as a display rule; stays open with a precise finding. No evidence structure records an instrument name, so there is no captured name to render beside the current one. internal.build_revision_envelope freezes record, blocks, record_links (targetIdentifier is a record), scientificTables, formulas and files - no instrument column and no join to api.instruments. api.revision_evidence_package and api.revision_sheet_evidence carry instance_state, composed_grid and dataset_versions only. A reference field freezes reference_id (a uuid), never a display name, and although 'instrument' is a valid model key so a dataset reference *can* target an instrument, only the uuid is frozen. Instruments are not api.records and record_links.link_type excludes instrument, so an instrument cannot be referenced as evidence at all. Instrument names appear only live (api.sample_measurement_provenance joins api.instruments at read time for the sample Measurements tab; api.dataset_imports.instrument_id is a live FK), and the only durable trace of past names is the workspace-wide change-event log behind api.instrument_history, which is not part of the evidence package. The design expects an 'Instrument name | Turbidimeter 2 | Turbidimeter TB-02' row (screen-text/EvidenceCompare.txt) and a signed record showing the name used when signed with the current name beside it (screen-text/RecordInstrument.txt); neither value exists in any frozen artifact. Closing this needs a decision about capturing the instrument name (and its identifier) into the revision envelope or the sheet evidence at signing - a model change, not a display rule. Nothing was invented and no migration was written.
