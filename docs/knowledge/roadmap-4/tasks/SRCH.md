# SRCH — Search and Command Palette

**Status (2026-09-27):** Proposed; not assigned. Extends FIND and ADR-0033.

## Programme goal

Find anything by name, ID, cell value, comment or file content, from anywhere,
without ever revealing what a person cannot open.

## Baseline at `main` `9538f36`

`api.search` RPC with PostgreSQL full-text search over records, block text,
samples, datasets, sheets, files and file metadata (`src/lib/search.ts`);
`/search` page. Comments, dataset and sheet cell values and file contents are
not indexed; there is no global palette.

## SRCH-01 — Search coverage

**Status:** proposed.

### Design

`canvas/SearchResults.dc.html`, `canvas/SearchEmpty.dc.html`.

### Scope

Index comments (Liveblocks threads mirrored or queried with permission
checks), dataset row values and sheet row values (matched column shown), and
text content of uploaded files (CSV, text; PDF text where available) with the
matching line; include-archived option; "did you mean" for near-miss IDs.

### Exit

Searching the seeded "C-150" returns the nine results in the design grouped by
type; results are filtered by RLS (tested with a viewer and a user outside
the project).

## SRCH-02 — ⌘K palette and results page

**Status:** proposed; frame in SHELL-03.

### Design

`canvas/SearchPalette.dc.html`, `canvas/SearchResults.dc.html`, `canvas/SearchEmpty.dc.html`.

### Scope

Palette with scope selector, grouped results, keyboard navigation, open in new
tab, contextual actions ("Register a sample from C-150…"), "see all results";
results page with type, project and updated facets, relevance sort and match
context.

### Exit

Palette and results page match the design; the palette opens from anywhere
with ⌘K and returns focus on close.
