# 0022. Cross-sheet formula resolution and locking

- Status: Accepted
- Date: 2026-07-20
- Ticket: CALC-003
- Builds on: 0019, 0020, 0021

## Context

Scientists need to write formulas with recognizable sheet names, while saved
calculations must survive sheet rename and block reorder. Formula writes can
also race direct REST row writes, source deletion, and schema evolution across
multiple generated PostgreSQL relations.

## Decision

The v1 editor accepts same-notebook references in A1 form with a friendly sheet
qualifier, for example `='Raw measurements'!A1`. Unquoted identifier-like names
are also accepted. Quoted names escape an apostrophe as `''`. Resolution is
case-insensitive and requires exactly one active sheet with that display name;
missing or ambiguous names are rejected before persistence.

The trusted server resolves the display name against active scientific tables
belonging to the target notebook record. Persisted cell and range bindings add
the source table UUID, and expanded dependency edges store source table, row,
and column UUIDs. Source text remains provenance, not binding authority.
HyperFormula receives a deterministic engine sheet name derived only from the
table UUID. Consequently, sheet rename and notebook block reorder do not alter
calculation meaning.

A trusted formula transaction locks all active scientific-table catalog rows in
the notebook by table UUID, then locks all corresponding generated relations by
resource name before validating any source. This deliberately conservative
single-user-alpha policy gives formula writes, row deletion, and schema changes
one stable lock order. PostgreSQL then requires every source table to be active
in the target workspace and notebook record and every bound source row and
column to exist. The submitted dependency set must exactly equal the server-
derived binding set.

Generated resource names still pass the closed `sheet_[a-z2-7]{26}` grammar
before quoted interpolation. The replacement security-definer function revokes
execution from public, browser, and API roles and grants it only to the
`formula_writer` capability role.

Source row deletion, source-column retirement or conversion, and deletion of a
sheet block participating as either source or target are rejected while durable
formulas remain. The sheet configuration UI reads dependency edges and explains
the affected formula count before schema mutation; the formula-cell inspector
shows friendly locations backed by stable identities.

Notebook workbooks register every engine sheet before installing formulas, so
block registration order cannot affect resolution. Durable row and formula
events invalidate the complete source-row/formula projections needed to rebuild
the workbook. Cross-sheet cycles remain valid definitions and render the
structured `CYCLE` result selected in ADR 0021.

## Consequences

- Display names stay approachable but are never durable calculation identity.
- Duplicate sheet names are allowed as display metadata but cannot be used in a
  textual cross-sheet formula until disambiguated.
- Formula writes lock more relations than their immediate dependencies. This is
  acceptable for the single-user alpha and favors correctness over concurrency;
  a later multi-user design may replace it with a dependency-aware lock plan
  while preserving stable order.
- Cross-notebook references are not representable through the trusted write
  contract or accepted by PostgreSQL.
