---
id: subtask-223
title: DSET-06.1 — api.parsers and api.parser_versions
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: task-222
tags:
  - DSET-06.1
  - DSET
---

# DSET-06.1 — api.parsers and api.parser_versions

Step 1 of 3 in [DSET-06](../../tasks/DSET.md#dset-06--parsers-per-instrument); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: verified against current code and closed. api.parsers, api.parser_versions and api.parser_mappings exist with the create, ensure, mapping, update-request and approve RPCs; parser_versions carries signature, mapping, test_result, validated_at and the approval columns, so validation evidence is retained rather than inferred from status. tests/db/parser-validation.test.ts (covering canonical instrument/format scope, refusal of direct status forgery, approval only with successful retained evidence, and stale/mismatched checksum rejection) passes with the planned-row suites: 21 tests across three files.
- 2026-10-04: Reopened 4 October: 0299/0300 provide version storage/create/approve, but no retained-test-file validation operation; approval accepts draft. Complete authoritative validation and gate approval, rather than treating columns as workflow acceptance.
