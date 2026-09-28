---
id: subtask-181
title: SRCH-01.3 — File contents
type: subtask
status: in-progress
priority: high
created: "2026-09-27"
updated: "2026-09-28"
parent: task-178
tags:
  - SRCH-01.3
  - SRCH
---

# SRCH-01.3 — File contents

Step 3 of 4 in [SRCH-01](../../tasks/SRCH.md#srch-01--search-coverage); the full step text is under “Steps” there.

## Work Log
- 2026-09-28: PR #206: CSV/TXT/JSON uploads extract text into file_objects.extracted_text; the text feeds the maintained record search vector and api.search_file_contents returns the matching line and line number, scoped by RLS. DB tests cover member, viewer, outsider and records; the upload test proves extraction. PDF text-layer extraction needs a parser dependency and remains.
