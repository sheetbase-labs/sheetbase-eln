---
id: subtask-170
title: EXP-05.2 — Offline mode UI
type: subtask
status: done
priority: low
created: "2026-09-27"
updated: "2026-10-10"
parent: task-168
tags:
  - EXP-05.2
  - EXP
---

# EXP-05.2 — Offline mode UI

Step 2 of 5 in [EXP-05](../../tasks/EXP.md#exp-05--offline-editing-and-conflict-resolution); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: UI implemented (delegated, then verified by the coordinator). The notebook says when it is offline and what is waiting: a banner with the last sync time, the pending count and a Retry that actually reconnects (the live coordinator needed a real reconnect, since connect was a no-op while a stream existed); unsynced markers on the blocks and cells carrying a draft; the unsynced list in the inspector, fed from the device store rather than a copy; and Submit and Sign disabled with the reason stated and linked when the connection is down. Ten tests in the new file, 153 across the touched files. Gaps reported rather than papered over: nothing writes into the device store yet - recording offline drafts is the replay's job (EXP-05.3) or a dedicated step - so in a live session the count, markers and list stay empty until that lands, and the UI is proven against an in-memory store; block markers sit at the top of block content because NotebookBlock receives no block id and its frame lives in notebook-document.tsx, which this change did not own; and the last-sync time is a client-side clock that resets on reload, because no persisted server sync timestamp exists.
