---
id: subtask-284
title: LAB-04.1 — Per DEC-07, either rename reagents to materials
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: task-283
tags:
  - LAB-04.1
  - LAB
---

# LAB-04.1 — Per DEC-07, either rename reagents to materials

Step 1 of 3 in [LAB-04](../../tasks/LAB.md#lab-04--materials-and-lots); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: completed (the owner decided the rename; the code half delegated, the database half and the diagnosis by the coordinator). The record kind and link type are now `material` everywhere in src/ and tests/ - the kind and link-type vocabularies, labels, the routes and data modules, the seeds and fixtures, the tests, and the user-visible copy. Internal names are deliberately untouched: the record_reagent_movement / reagent_attention_summary / emit_reagent_expiry_events RPCs, the reagent_movements table and its reagent_record_id column, and the reagent-data module - the step asks for the kind, routes and copy, and a module name is not a kind. The database side reached further than the kind alone, and every one of these was a place the rename would otherwise have failed silently: api.model_kinds carries the kind twice (`key`, which the registry's foreign keys target, and `record_kind`, which the record guard reads) and they are circular, so the foreign key was dropped, both renamed together and restored; api.model_base_fields (104 rows) and api.model_rules declare a kind's fields and rules, and guard_record_properties validates every written property against them, so leaving them behind made every seeded material record fail with 'unknown legacy property lot'; nine functions and one view compared the kind or link type as a quoted literal, one of them the held-lot refusal in create_record_link, which is why a test failed on a unique violation instead of the refusal it expected - the guard had silently stopped firing; and api.my_work_items is a view, not a function, so the function-only pass missed its expiring-material branch and the inbox quietly stopped listing an expiring material. Every patch replaces the quoted literal only, so unquoted table, column and function names are untouched, and each migration asserts nothing is left comparing the old kind. Acceptance: DB 211/212 files, 1572/1575 tests (only the three environmental design-scenarios failures), unit 388 files / 4026 tests, typecheck clean.
