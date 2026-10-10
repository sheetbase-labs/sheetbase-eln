---
id: subtask-268
title: MDL-04.3 — Record page with sections, "field added in version n" banner, used-by,…
type: subtask
status: done
priority: low
created: "2026-09-27"
updated: "2026-10-03"
parent: task-265
tags:
  - MDL-04.3
  - MDL
---

# MDL-04.3 — Record page with sections, "field added in version n" banner, used-by,…

Step 3 of 3 in [MDL-04](../../tasks/MDL.md#mdl-04--model-lists-generated-forms-and-record-pages); the full step text is under “Steps” there.

## Work Log
- 2026-10-03: MDL-04.3 implemented. /models/$modelId/records/$recordId + RecordModelRecord: model fields as a Details list, a banner for fields created after the record that it does not carry, Used-by from incoming record_links, the canonical api.record_timeline via RecordHistoryTimeline, and an honest integrations note. Route restructured so records/ is a layout with index/new/$recordId children. Acceptance: pnpm test 3427; screens 100x2; areas (Details/Used by/History sections), interactions, phone, crawl green.
