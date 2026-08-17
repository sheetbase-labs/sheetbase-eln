# COLLAB — Collaboration

**Status:** planned.

## Programme goal

Add useful collaborative awareness and review without turning Sheetbase into a chat or project-management product.

## COLLAB-01 — Presence & Concurrent Awareness

Who is viewing/editing; object/block/Sheet awareness; stale-write communication; refresh/reload guidance; optional realtime propagation where justified.

Do not assume full CRDT collaborative editing is required.

**Exit:** concurrent work is visible and conflicts are understandable rather than surprising.

## COLLAB-02 — Comments, Mentions & Resolution

Comments on Notebook blocks, Sheet cells/ranges where identity is stable, Records and Datasets; threads; mentions; resolve/reopen; durable anchors; permissions; audit context.

**Exit:** scientific discussion can remain attached to the object/value it concerns.

## COLLAB-03 — Notifications

In-app notification centre; mentions; review requests; failed imports; relevant configuration changes; delivery preferences; read/unread; links to source; optional email later.

**Exit:** important collaboration events reach users without requiring manual polling.

## COLLAB-04 — Lightweight Review & Tasks

Review requests, assignees where useful, status, due dates only if justified, links to evidence/comments, completion/resolution.

**Exit:** common scientific review coordination works without reproducing a general task tracker.

## Boundaries

- Stable anchors are required before comments attach to cells/ranges.
- Notifications should be event-driven and permission-aware.
- Do not build a generic Jira clone.
