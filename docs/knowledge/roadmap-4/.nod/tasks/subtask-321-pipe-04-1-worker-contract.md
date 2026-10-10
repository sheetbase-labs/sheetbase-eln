---
id: subtask-321
title: PIPE-04.1 — Worker contract
type: subtask
status: done
priority: low
created: "2026-09-27"
updated: "2026-10-10"
parent: task-320
tags:
  - PIPE-04.1
  - PIPE
---

# PIPE-04.1 — Worker contract

Step 1 of 3 in [PIPE-04](../../tasks/PIPE.md#pipe-04--file-and-figure-outputs); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: implemented. The runner collects the declared output directory after a step runs and before the container is removed (a stopped container is readable only until then), reporting each file with its size and bounding both the count and the total bytes - refusing rather than truncating, and naming the size it saw. The container's only writable path is the tmpfs at /tmp/out (the root is read-only), which is where a function's figure or table lands. The response carries names and sizes, never contents, so a large figure does not travel through the run's JSON result. The app declares an artefactKey and surfaces the files on the step's result; a step that declares no key returns none, which is what every existing step does. The key becomes a directory name, so it is validated against escaping the root. Verified: 5 runner tests and 10 app client tests.
