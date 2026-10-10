---
id: subtask-355
title: REV-02.3 — Signatures table on signed records
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: task-352
tags:
  - REV-02.3
  - REV
---

# REV-02.3 — Signatures table on signed records

Step 3 of 3 in [REV-02](../../tasks/REV.md#rev-02--signature-meanings-and-author-signing); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: implemented (delegated, then verified by the coordinator). src/components/review/signatures-table.tsx renders the canvas's Signatures table on a signed record: Name, Meaning, Signed and Signature ID, oldest-first from fetchSignaturesForRecord, with the binding note naming the revision version. Where the revision's version is unknown the note says it is bound to the frozen revision it attests rather than inventing a number; a missing signer name says so; empty, loading and failure are each distinct (a failure is an alert, never an empty table). It is mounted on the record notebook's signatures tab, replacing the inline table. Five component tests cover ordering, meaning labels, IDs, the binding note in both the known and unknown-version cases, the empty state and the failure state. Not exercised: the live tab in a browser.
