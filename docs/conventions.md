# Working conventions

These conventions keep names predictable across PostgreSQL, PostgREST, the
application and tests. Follow them unless a decision record in
`docs/decisions/` says otherwise.

## Directory boundaries

| Path                               | Role                                                                     | May import from                 |
| ---------------------------------- | ------------------------------------------------------------------------ | ------------------------------- |
| `src/`                             | Production application. Only code here ships.                            | `src/` and packages             |
| `Concepts/sheetbase-ui-system-v2/` | UI-system study. Reference only; not a dependency, not built by the app. | Nothing in `src/` may import it |
| `Mockups/`                         | Product mockups and the specification PDF. Reference only.               | Never imported                  |
| `docs/`                            | Working conventions and decision records.                                | Never imported                  |

Copying small, reviewed pieces from `Concepts/` into `src/` is expected when a
ticket productionises a component. Importing the concept project, adding it as
a package dependency, or wiring its build into the app is not allowed: the
concepts contain decisions still under review.

## Database object naming

- Tables: plural snake_case nouns (`workspaces`, `workspace_memberships`,
  `projects`). Join tables name both parents, parent first.
- Primary keys: `id`, `uuid` type, database-generated.
- Foreign keys: `<singular_parent>_id` (`workspace_id`), always with an
  explicit constraint and an index.
- Timestamps: `created_at`, `updated_at`, `archived_at`, `revoked_at` —
  `timestamptz`, database-generated defaults. Lifecycle moments get their own
  past-tense column; do not overload a single `status` timestamp.
- Stable public identifiers: a separate column (`key`, `slug` or type-prefixed
  id) where a record needs a human-facing or API-facing identity. Internal
  primary keys never appear in URLs or public API examples.
- Constraints and indexes: `chk_<table>_<meaning>`, `uq_<table>_<columns>`,
  `idx_<table>_<columns>`, `fk_<table>_<column>`.
- RLS policies: `<table>_<action>_policy` where action is
  `select|insert|update|delete` plus a qualifier when needed
  (`projects_select_member_policy`).
- Schemas: `api` for the PostgREST-exposed surface, `internal` for everything
  PostgREST must never see. Nothing user-owned lives in `public`.
- Exception: Better Auth core tables in `internal` keep Better Auth's quoted
  camelCase column names, because those tables implement Better Auth's
  contract, not Sheetbase domain naming (see decision record 0003). The
  exception never spreads to domain tables.

## REST resource naming

PostgREST exposes tables and views by name, so resource names follow the
database rules above:

- Safe-CRUD resources are plural snake_case nouns under `/projects`,
  `/workspace_memberships` etc., matching the exposed `api` schema object.
- Read-only composite views are named for what the reader gets
  (`project_summaries`), not for their join structure.
- Mutation RPCs live under `/rpc/<verb>_<noun>` (`/rpc/create_project`,
  `/rpc/move_block`) and are used only when direct CRUD cannot keep the
  required integrity.
- Field names are stable once published. Rename by adding the new name and
  retiring the old one in a later change, never by silent aliasing.

## Domain identifier naming

- Every user-visible record type has a stable, type-scoped public identifier
  separate from its database primary key.
- Identifiers are lowercase, URL-safe and, where humans read them aloud,
  pronounceable or at least short (`proj_…`-style prefixes are acceptable when
  the type list stays small and documented).
- Identifiers are immutable. Display titles change freely; identifiers do not.

## Event type naming

Change and audit events use `<domain>.<entity>.<past_tense_verb>`:

- `project.created`, `project.archived`
- `notebook.block_inserted`, `notebook.block_moved`, `notebook.block_updated`
- `review.submitted`, `review.signature_recorded`

The entity segment uses the singular domain noun. New event types are added,
never renamed: consumers may be replaying history.

## TanStack Table vs Handsontable

Both are in the stack deliberately. Choose per surface, not per preference.

- **TanStack Table** is the default for tables: registries, queues, review
  inboxes, search results and any read-oriented operational view. It stays
  headless under Sheetbase styling and supports server-side pagination,
  filtering and sorting.
- **Handsontable** is only for spreadsheet-like scientific editing: sheet
  blocks, dataset edit modes and plate-adjacent entry where cell-range
  selection, fill handles, paste matrices and in-cell editors are the actual
  task. It always sits behind the Sheetbase wrapper component
  (see `SHEET-001` in `TODO.md`), never as a raw vendor instance.
- If a surface only needs row selection, sorting and an inspector, it is
  TanStack Table. If you are reaching for Handsontable to get a nicer looking
  read-only grid, stop and use TanStack Table.

## Formatting and linting

Prettier owns formatting, ESLint owns code rules. `pnpm format` applies both;
`pnpm check` verifies formatting in CI and in `pnpm validate`. Do not hand-tune
formatting that Prettier will revert.
