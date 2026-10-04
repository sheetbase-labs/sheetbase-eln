---
id: subtask-184
title: SRCH-02.1 — Palette content
type: subtask
status: done
priority: high
created: "2026-09-27"
updated: "2026-10-02"
parent: task-183
tags:
  - SRCH-02.1
  - SRCH
---

# SRCH-02.1 — Palette content

Step 1 of 2 in [SRCH-02](../../tasks/SRCH.md#srch-02--k-palette-and-results-page); the full step text is under “Steps” there.

## Work Log
- 2026-10-02: SRCH-02: the palette now has the design scope selector, grouped results (max per group), contextual actions by kind, Cmd/Ctrl+Enter new tab, Esc focus return, See all, and no ad-hoc global listener (shell registry owns mod+k). The results page pages api.search with p_limit/p_offset and passes URL facets as RPC args (server filtering) with match-context highlights, a project facet, Load more driven by the RPC total_count, and the SearchEmpty state. New pure helpers unit-tested (search.test.ts 99). Evidence: pnpm test 302/3227, interactions (17), areas, screens 96x2, crawl 300 all green. Commit 91601b87. Caveat: an exact global filtered total for mixed client-side facets needs an RPC change (archived filter / multi-value type); the page shows the loaded matching count.
