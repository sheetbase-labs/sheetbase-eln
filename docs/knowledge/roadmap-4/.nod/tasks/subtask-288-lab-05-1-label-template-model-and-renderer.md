---
id: subtask-288
title: LAB-05.1 — Label template model and renderer
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: task-287
tags:
  - LAB-05.1
  - LAB
---

# LAB-05.1 — Label template model and renderer

Step 1 of 4 in [LAB-05](../../tasks/LAB.md#lab-05--labels-and-scanning); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: implemented by the coordinator. The inspector's label preview drew a fixed decorative pattern that could not be scanned (its own comment deferred the scannable template to LAB-05); it now renders a real QR of the DEC-10 payload https://<host>/r/<identifier>, built in src/lib/labels.ts so the printed code and the resolver route cannot drift, and draws no code when there is no host rather than a code that resolves nowhere. api.label_templates (drizzle/0399) describes what a label carries per record kind - name, kind, whether the condition and use-by print - with RLS read for workspace members; the payload is deliberately not a column, because a template must not be able to change what a printed code resolves to. The preview is mounted as a Label section on the sample page, which previously showed no label at all. Verified by decoding the rendered code: the SVG path taken from the running page was rasterized and read back with jsqr, returning https://localhost:3000/r/SMP-LAB051-CHECK exactly, which is the task's own 'scanning a rendered QR image' check. 12 unit tests cover the payload, the line builder and the card's no-host state. Dependency note: qrcode and jsqr were added on the owner's decision.
