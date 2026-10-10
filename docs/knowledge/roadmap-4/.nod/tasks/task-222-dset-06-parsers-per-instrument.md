---
id: task-222
title: DSET-06 — Parsers per instrument
type: task
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: epic-195
related:
  - task-2
tags:
  - DSET-06
  - DSET
  - wave-C
---

# DSET-06 — Parsers per instrument

Spec: [DSET-06 in tasks/DSET.md](../../tasks/DSET.md#dset-06--parsers-per-instrument)

- Stream: DSET (epic-195)
- Wave: C
- Waits on: DEC-01 (task-2)
- Steps: 3 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): not-started. Evidence: src/lib/connectors/registry.ts:1 — existing connector registry baseline; src/db/schema.ts — no parsers/parser_versions model; docs/knowledge/roadmap-4/tasks/DSET.md — versioned parser task differs from existing connector ingestion. Remaining: All three steps remain: parser definitions/versions and test-file validation/QA approval; parser-version import provenance and governed gating; instrument settings plus failure work items. Existing connectors are not versioned instrument parser approval. See docs/knowledge/roadmap-4/RECONCILIATION.md#dset-06. Source audit, not fresh service/browser acceptance.
- 2026-10-10: All steps done; closed by roadmap sync.
