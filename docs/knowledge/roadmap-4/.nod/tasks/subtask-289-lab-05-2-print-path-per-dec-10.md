---
id: subtask-289
title: LAB-05.2 — Print path per DEC-10
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: task-287
tags:
  - LAB-05.2
  - LAB
---

# LAB-05.2 — Print path per DEC-10

Step 2 of 4 in [LAB-05](../../tasks/LAB.md#lab-05--labels-and-scanning); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: implemented (client delegated, the print event by the coordinator). The sample header's print action opens the browser print for a label document carrying the LAB-05.1 label (the QR of the DEC-10 payload, identifier, lot, storage condition and use-by), and the print is recorded on the sample. DEC-10 says the lab has no specific printers, so the toast reads 'Label sent to print' rather than naming a printer that does not exist. The coordinator added the missing piece the implementer flagged: sample_events.operation gains 'print' and a dedicated record_sample_label_print RPC (drizzle/0402), because recording the print as an edit made the History say 'Edited' for something that changes nothing about the sample; the RPC refuses a stale metadata version and a non-sample record, moves no quantity, and the History now reads 'Printed label'. 33 client tests and 13 DB tests. Not verified: the real browser print dialog and the print stylesheet.