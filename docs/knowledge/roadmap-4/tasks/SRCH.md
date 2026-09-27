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

### Start here

- Search RPC and indexes: `drizzle/0031_sci_008_search_rpc.sql` (first
  version) through `drizzle/0132_data_04_global_search.sql` (current global
  search); ADR-0033.
- `src/lib/search.ts` (767 lines: result types `record`, `block_text`,
  `sample`, `dataset`, `sheet`, `file`, `file_metadata`), `src/routes/search.tsx`.
- Comments are stored in `api.comments` (`target_kind`, `target` JSON,
  `record_id`), so they can be indexed directly.
- Tests: `tests/db/data-04-search.test.ts`, `tests/api/search.test.ts`.

### Steps (PRs)

1. Comments: add a generated `tsvector` column and GIN index on comment text;
   add `comment` results (record, anchor, author, time) respecting the
   record's RLS. DB test incl. a viewer and an outsider.
2. Cell values: index dataset row values and sheet row values (text form of
   each cell with its column label) in a search table maintained by triggers;
   results carry dataset/sheet, row numbers and the matched column. Measure
   index size on the month seed (`pnpm db:seed:month`) and record it here.
3. File contents: at upload, extract text for CSV/TXT (and PDF text when a
   text layer exists) into a searchable column with line numbers; results show
   the matching line.
4. "Did you mean": trigram similarity (`pg_trgm`) on identifiers when there are
   no results; include-archived flag.

### Check it

DB tests per result type with isolation; the design seed query "C-150"
returns the nine design results.

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

### Start here

SHELL-03's palette frame; `src/lib/search.ts` for query building and deep links
(`deep link generation from result kind and project`); `src/routes/search.tsx`.

### Steps (PRs)

1. Palette content: debounced query, grouped results (max per group), scope
   selector, contextual actions registered by kind (for example "Register a
   sample from …"), keyboard (↑↓, Enter, ⌘Enter new tab, Esc), "See all".
2. Results page rebuilt per `SearchResults` with type/project/updated facets,
   sort, match context highlighting (`highlight` token), empty state per
   `SearchEmpty`.

### Check it

Component tests for keyboard and grouping; parity for `SearchPalette`,
`SearchResults`, `SearchEmpty`.

### Exit

Palette and results page match the design; the palette opens from anywhere
with ⌘K and returns focus on close.
