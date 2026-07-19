# 0012. Notebook and visualisation frames as presentational, stateless components

- **Status:** accepted
- **Date:** 2026-07-18
- **Ticket:** UI-006

## Context

The concept `NotebookBlock`, `ChartFrame` and `PlateMap` were visual
demos tied to hard-coded data (a fixed 96-well array, a "Live" badge, a
single selected well). Product needs them as reusable frames that work in
both full-width canvases and narrow notebook columns, with explicit states
and no embedded persistence, and with keyboard parity for drag handles,
menus and plate wells.

Forces:

- Notebook persistence (block order, content, save state) belongs to the
  route/store, not the block frame. The frame must be presentational.
- Charts need honest provenance, a live/snapshot distinction, a legend and
  a text alternative for screen readers.
- Plate wells must be real buttons so keyboard users can traverse and
  select them; missing/empty wells must be distinct from zero.

## Decision

1. **Two modules.** `src/components/notebook/` (`NotebookBlock`) and
   `src/components/viz/` (`ChartFrame`, `PlateMap`), each barrel-exported.

2. **NotebookBlock is a stateless frame.** It takes a `state` of
   `default | selected | editing | dragging | invalid | locked | loading |
   read-only`, renders the corresponding ring/overlay/skeleton, and never
   owns content or order. The drag handle is a focusable `draggable` button
   that appears on hover/focus (not mouse-only). The action menu is a
   `DropdownMenu` whose items are disabled under read-only/locked. `data-
   state` is set for tests and audits.

3. **ChartFrame is a figure with chrome.** It renders a `<figure>` with
   `aria-labelledby` (title) and `aria-describedby` (alt), a Live/Snapshot
   badge, optional subtitle, provenance footer, legend and a download/
   expand/more action group. `loading` swaps the body for a skeleton. The
   chart itself is `children`, so the frame never ties to a rendering
   library or sample data.

4. **PlateMap is a semantic grid.** Rows (`A`–`H`) and columns (`1`–`12`)
   are `rowheader`/`columnheader`; each well is a `<button role=gridcell>`
   with `aria-selected` and an `aria-label` (per-well label or
   `A1 (empty)`). Missing wells (no value / null) render with a distinct
   muted fill and an "(empty)" label, separate from zero. A legend explains
   the colour bands; `compact` shrinks the grid for narrow notebook columns.
   Selection is controlled (`selectedIndex`/`onSelect`).

5. **Responsive width.** All three rely on flex/grid and `compact` flags
   rather than fixed widths, so they work full-width and in notebook
   columns.

## Consequences

- `/foundations` gains a "Notebook & visualisation frames" section showing
  selected/loading/invalid blocks, a live chart with provenance+legend+alt,
  a snapshot loading chart, and a compact 96-well plate.
- Notebook routes compose `NotebookBlock` over their block store; the
  frame never persists. Chart and plate-map routes pass typed data and
  selection. No component imports sample data.
- UI-007 hardens `AuditTrail` and `ApprovalStepper` (audit/approval), which
  are orthogonal to these frames.
