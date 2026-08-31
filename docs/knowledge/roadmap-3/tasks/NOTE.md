# NOTE — Notebook Authoring & Composition Depth

**Status:** active; NOTE-01 in review (#100), NOTE-02 implemented on the same stack, NOTE-03..04 planned.

## Programme goal

Make the Notebook a powerful scientific authoring surface rather than a thin container around blocks.

## NOTE-01 — Authoring Interaction Baseline

### Goal

Make editing, inserting, moving and deleting Notebook content fluid and predictable.

### Scope

- block insertion/navigation/reordering;
- keyboard-first authoring and selection;
- clear active/selected/drag states;
- robust empty states and insertion affordances;
- autosave/conflict behaviour consistent with accepted Notebook contracts.

### Exit

A scientist can build and restructure a realistic Notebook without fighting block mechanics or losing focus/state.

## NOTE-02 — Sections, Structure & Long-Document Navigation

### Goal

Support coherent long scientific records.

### Scope

- sections/headings/outline navigation;
- collapse/expand and jump-to-section;
- stable block/section anchors where appropriate;
- print/export/read modes that preserve structure;
- avoid making visual hierarchy a second semantic ownership model.

### Exit

Long Notebooks remain navigable and understandable during authoring, review and read-only use.

### Implemented contract

- **Structure is a projection, not a second model.** Sections are derived
  from the H2/H3 heading nodes that already exist inside `rich_text` block
  payloads (`notebookOutline` in `src/lib/notebook-outline.ts`). No heading
  block type, no section table, no stored outline: the canonical structure
  stays the block list; the outline is computed on read.
- **Stable anchors.** Every rendered heading carries
  `id="section-<blockId>-h<index>"` — block UUID plus the heading's ordinal
  within the payload — in previews, read-only editors and historical
  evidence alike. Outline links target those anchors; deep links to whole
  blocks (`#block-<id>`) are unchanged.
- **Outline tab.** The notebook inspector gains an Outline tab (live and
  historical evidence views) listing sections in document order with
  level-based indent and jump links; empty state explains how to build one.
- **Collapse.** Live authoring canvases can collapse a section (its owned
  blocks are hidden and a "Show" placeholder appears under the heading).
  Collapse state lives in the route, resets on record/revision change, and
  is never persisted to block data. Read-only and historical canvases show
  the outline without collapse controls.
- **Print preserves structure.** Collapsed blocks are hidden with
  `hidden print:contents`, so printing always emits the complete document.
  JSON record export already carries full payloads.

## NOTE-03 — Scientific Block Composition

### Goal

Improve how Sheets, figures, analyses, files, Records, procedures and other scientific content compose inside a Notebook.

### Scope

- consistent block framing and resize/layout behaviour;
- rich object previews with inspect/open actions;
- provenance/version state visible when relevant;
- shared live vs frozen evidence distinctions;
- preserve canonical underlying object identity.

### Exit

Scientific blocks feel like coherent Notebook content while still exposing their canonical source/version/evidence semantics.

## NOTE-04 — Review, Submission & Evidence Authoring UX

### Goal

Make the transition from working Notebook to reviewed/submitted evidence understandable.

### Scope

- pre-submission checks and evidence preview;
- clear mutable/live versus frozen/submitted state;
- review/sign/amend affordances without changing human-session security boundaries;
- reconstruction of submitted content using canonical evidence contracts.

### Exit

A user can understand exactly what will be frozen/submitted, complete review actions, and later inspect the resulting evidence without confusing audit history with snapshots.

## Boundaries

- No generic Notebook Version concept beyond accepted revision/evidence semantics.
- Do not copy Dataset/Record state into Notebook payloads merely for rendering convenience.
- Submission/signing remains governed by canonical server/session contracts.
