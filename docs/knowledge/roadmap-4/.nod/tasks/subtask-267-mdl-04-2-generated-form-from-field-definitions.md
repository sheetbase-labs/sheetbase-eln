---
id: subtask-267
title: MDL-04.2 — Generated form from field definitions
type: subtask
status: done
priority: low
created: "2026-09-27"
updated: "2026-10-03"
parent: task-265
tags:
  - MDL-04.2
  - MDL
---

# MDL-04.2 — Generated form from field definitions

Step 2 of 3 in [MDL-04](../../tasks/MDL.md#mdl-04--model-lists-generated-forms-and-record-pages); the full step text is under “Steps” there.

## Work Log
- 2026-10-03: MDL-04.2 implemented. /models/$modelId/records/new + RecordModelNew: form generated from the model's active fields (ModelFieldInput for type/unit/choice/record-link), model rules evaluated inline by a client mirror of the SQL DSL (lib/model-rules.ts), ID preview from the model prefix, and submit through api.create_model_record. Client validation uses the same field-value-validation kernel the RPC enforces; server errors are mapped to human messages. Unit tests for the rule evaluator and form helpers. Acceptance: pnpm test 3427; screens 100x2; areas (new form + inline rule), interactions, phone, crawl green.
