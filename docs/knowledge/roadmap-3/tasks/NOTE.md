# NOTE — Notebook Authoring & Composition Depth

**Status:** active; NOTE-01 in review (#100), NOTE-02 and NOTE-03 implemented on the same stack, NOTE-04 planned.

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
  blocks (`#block-<id>`) are unchanged. During authoring the same anchors
  are projected into the active Tiptap DOM via ProseMirror node
  decorations (a read-only view plugin in `rich-text-editor.tsx`): the ids
  never enter the payload, so outline clicks navigate the block the user
  is actually editing.
- **Outline tab.** The notebook inspector gains an Outline tab (live and
  historical evidence views) listing sections in document order with
  level-based indent and jump links; empty state explains how to build one.
- **Collapse.** Live authoring canvases can collapse a section (its owned
  blocks are hidden and a "Show" placeholder appears under the heading).
  Collapse state lives in the route, resets on record/revision change, and
  is never persisted to block data. Read-only and historical canvases show
  the outline without collapse controls.
- **Same-block collapse.** A section also owns the nodes inside its own
  `rich_text` block after the heading: from the next node up to the next
  heading in the same block (any level) or the end of the block
  (`nodeRange` in `notebookSectionSpans`; later blocks stay block-granular
  as before, and same-block ranges are disjoint by construction). Read
  renderers hide those nodes with `hidden print:contents`; the active
  Tiptap editor hides the corresponding ProseMirror nodes with the same
  class via node decorations. The payload is never edited by collapse.
  A heading with nothing after it in its own block and no following blocks
  offers no collapse control.
- **Print preserves structure.** Collapsed blocks and collapsed same-block
  content are hidden with `hidden print:contents`, so printing always emits
  the complete document. JSON record export already carries full payloads.

## NOTE-03 — Scientific Block Composition

**Status:** completed 2026-08-31.

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

### Implemented contract

- **Canonical open affordances, UUID only.** Every scientific block preview
  that references a canonical object offers a compact "Open" link built
  exclusively from the navigation helpers in `src/lib/navigation.ts`
  (`sheetPath`, `datasetPath`, `recordDestination`). Links are built from
  stable UUIDs; a stored display label alone never produces a link.
  Coverage: sheet read previews ("Open full sheet", parity with the NAV-02
  live embed), chart blocks ("Open dataset" from `spec.datasets[0]`, or the
  frozen provenance's `datasetId`), analysis blocks ("Open dataset" from the
  live definition or the pinned provenance), protocol references ("Open
  protocol" via `protocolRecordId`), materials items (per-material Record
  open, suppressed while the record cannot be resolved), plate-map blocks
  (linked Samples listed under the grid), pipeline outputs (unchanged —
  already had Inspect run / Output Dataset), and file blocks (unchanged —
  already had download affordances gated on live `file_objects` status).
- **linked_record gains a stable identity field.** The payload now carries
  optional `targetId` — the Dataset UUID for `targetKind: 'dataset'`, the
  Record UUID otherwise — captured when a link is picked from search and
  cleared whenever the identifier is retyped by hand (a manually typed
  label is not identity). Legacy payloads that store only an identifier
  render no link rather than an ambiguous one. `validateLinkedRecord`
  accepts the optional field; no schema version bump, no migration.
- **Pinned version visible at a glance.** A frozen chart that pins a
  Dataset Version shows `Dataset Version <short-id>` as the ChartFrame
  subtitle (previously only in the sr-only description) alongside the
  existing Snapshot badge. Frozen analysis blocks keep their provenance
  caption and add the Dataset open affordance.
- **Live vs frozen stays the shared distinction.** No new evidence chrome:
  chart blocks use the existing ChartFrame Live/Snapshot badges, frozen
  analysis keeps the Snowflake badge and checksum provenance line, and
  frozen sheet blocks keep the FrozenSheetEvidencePanel. The only change is
  that frozen and live chart/analysis previews now share the same
  canonical-object open affordance, so the distinction is about mutability,
  not about navigability.
- **No framing redesign.** Block chrome (label, title, states, drag, menu)
  is untouched; NOTE-02's outline anchors, section collapse and
  `print:contents` behaviour are unaffected, and `notebook-outline.ts` was
  not modified. Resize/layout behaviour was audited and left as is (sheet
  embeds keep their min-height embed; charts keep the ChartFrame height).

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
