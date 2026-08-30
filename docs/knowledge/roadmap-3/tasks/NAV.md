# NAV — Workspace Navigation & Information Architecture

**Status:** planned; not active until promoted by `docs/knowledge/NEXT.md`.

## Programme goal

Make Sheetbase easy to orient, traverse and resume without flattening Notebook, Sheet, Dataset, Record and configuration concepts into generic pages.

## NAV-01 — Canonical Navigation Model

### Goal
Define and implement the canonical workspace/project navigation hierarchy and object destinations.

### Scope
- reconcile global, workspace, project and object navigation;
- remove duplicate/dead-end destinations and inconsistent naming;
- preserve stable object identity in URLs/navigation state;
- establish responsive sidebar/header behaviour.

### Exit
A user can predict where canonical object types live and move among workspace, project and object contexts without contradictory navigation models.

## NAV-02 — Context-Preserving Object Navigation

### Goal
Keep scientific context visible while moving between related objects.

### Scope
- breadcrumbs/back-stack semantics based on stable IDs;
- links between Notebook, Sheet, Dataset, Record, analysis and evidence views;
- preserve useful project/workspace context when following relationships;
- avoid label- or browser-history-dependent reconstruction.

### Exit
Opening a related scientific object and returning preserves understandable project/object context without relying on accidental browser state.

## NAV-03 — Navigation Productivity & Responsive Behaviour

### Goal
Make navigation fast for repeated daily use.

### Scope
- keyboard-first navigation/command entry points;
- compact project/folder/object switching;
- responsive mobile/narrow-screen behaviour without separate semantics;
- accessibility and focus restoration.

### Exit
Core navigation workflows are keyboard-accessible, responsive and demonstrably faster than repeated manual sidebar traversal.

## Boundaries

- Do not invent a second project/folder/object ownership model.
- Do not use display labels as durable identity.
- FIND owns recents/favourites/search ranking; NAV only provides navigation surfaces.
