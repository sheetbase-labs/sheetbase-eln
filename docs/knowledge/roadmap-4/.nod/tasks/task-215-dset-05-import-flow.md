---
id: task-215
title: DSET-05 — Import flow
type: task
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-04"
parent: epic-195
related:
  - task-2
tags:
  - DSET-05
  - DSET
  - wave-C
---

# DSET-05 — Import flow

Spec: [DSET-05 in tasks/DSET.md](../../tasks/DSET.md#dset-05--import-flow)

- Stream: DSET (epic-195)
- Wave: C
- Waits on: DEC-01 (task-2)
- Steps: 6 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: src/components/import/import-wizard.tsx:86-100,149-157 — browser preview/mapping/whole-file parse; src/lib/import-parse.ts:5-8 — 10MiB/1000 limits unchanged; src/lib/import-commit.ts:77-95 — one canonical dataset batch; docs/knowledge/roadmap-4/tasks/DSET.md:245-257 — raw file/parser/planned-row/streaming exits. Remaining: 1 route/wizard exists but raw-file checksum-first persisted stepper workflow incomplete. 2 registered parser recognition absent in wizard. 3 mapping exists but parser-default persistence/units incomplete. 4 planned/new/flagged/skipped server outcome preview and one snapshot/history absent. 5 three recovery choices incomplete. 6 streaming/workload limit exit not implemented. See docs/knowledge/roadmap-4/RECONCILIATION.md#dset-05. Source audit, not fresh service/browser acceptance.
- 2026-10-04: Import flow implemented (a465cbb1): 05.1 three-step flow, 05.2 parser recognition (tested), 05.3 mapping with units and saved defaults, 05.4 server-side review outcomes + one snapshot on commit, 05.5 failure page with three options, 05.6 limits raised to 64 MiB / 100k rows with server-side parsing. 05.1/05.3/05.4/05.5 are verified by typecheck and unit tests only — no browser end-to-end run yet, so their steps are left in-progress. A regression this exposed (0295 dropped commit_dataset_row_batch's planned-row fill) is fixed by 0301.
- 2026-10-04: DSET-05 verified end to end in a real browser (510a237b, tests/browser/import-flow.test.ts): checksum-first persisted upload, registered-parser recognition, unit/example mapping with a round-tripping parser default, server-computed outcomes (planned/new/flagged/skipped) writing exactly one snapshot with planned rows filled in place, and the failure page's three recovery options. The browser run found and fixed five bugs the unit tests missed (header detection, planned-key column, review jsonb path cast, save_parser_mapping arity/workspace, skipped controls committed).
- 2026-10-04: All steps done; closed by roadmap sync.
