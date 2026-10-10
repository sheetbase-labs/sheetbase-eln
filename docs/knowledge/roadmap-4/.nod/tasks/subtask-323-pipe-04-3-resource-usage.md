---
id: subtask-323
title: PIPE-04.3 — Resource usage
type: subtask
status: done
priority: low
created: "2026-09-27"
updated: "2026-10-10"
parent: task-320
tags:
  - PIPE-04.3
  - PIPE
---

# PIPE-04.3 — Resource usage

Step 3 of 3 in [PIPE-04](../../tasks/PIPE.md#pipe-04--file-and-figure-outputs); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: partially implemented; stays open on the unmeasurable half. The broker now measures per-step payload usage (input and output bytes, rows, cells) and the executor stores the element-wise peak on the run in the existing result jsonb, so no migration was needed; limit failures now name the measured value and the limit, and the error code maps from the broker's own codes instead of collapsing to transform_failed. NOT captured: peak child memory and peak storage, which are not measurable from the app side. src/lib/pipeline-python.server.ts is an HTTP client and never observes the child container; the only process with Docker access is scripts/pipeline-python-runner.mjs. A stopped container reports 0B, cgroup memory.peak lives on the host cgroupfs, and an OOM kill exits 137 with empty stdout and no limit number. Measuring either needs the runner to report it - a change to that script plus a protocol field, not a number to invent. Ten tests in the python broker file; usage is optional on the result type so the DB pipeline tests' fakes are unaffected.
