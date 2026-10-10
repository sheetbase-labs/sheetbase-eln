---
id: subtask-169
title: EXP-05.1 — Device store
type: subtask
status: done
priority: low
created: "2026-09-27"
updated: "2026-10-10"
parent: task-168
tags:
  - EXP-05.1
  - EXP
---

# EXP-05.1 — Device store

Step 1 of 5 in [EXP-05](../../tasks/EXP.md#exp-05--offline-editing-and-conflict-resolution); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: implemented (delegated, then verified by the coordinator). src/lib/offline/store.ts persists unsynced edits behind an OfflineStorage interface with a thin IndexedDB implementation and an in-memory one for tests - no dependency was added (idb-keyval and fake-indexeddb deliberately avoided). Edits are keyed per user and per record so isolation is by construction, and each carries what a replay needs: the target (block text, cell, row or comment), the intended value, the expected revision it was based on, and a monotonic sequence for replay order. Reads validate each persisted member and drop corrupt or unknown ones rather than throwing, repairing the store on the next write. 23 tests cover round-tripping all four kinds, per-user and per-record isolation, removing exactly the replayed edits, and corrupt data. It also added listScopes(userId) at EXP-05.5's request. Found and not invented: the SET-01 setting workspace_settings.allow_offline_editing exists in the domain but is not client-readable, so the store never decides whether editing is allowed - wiring that setting through workspace-admin is a separate SET-01 change. Not exercised: the IndexedDB code path (jsdom has no IndexedDB), which is covered by types rather than by a jsdom test.
