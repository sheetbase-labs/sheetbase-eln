# 0023. Revision-bound calculation results

- Status: Accepted
- Date: 2026-07-20
- Ticket: CALC-004
- Builds on: 0018, 0021, 0022

## Context

Formula definitions and PostgreSQL literals are authoritative, but API clients
also need queryable calculated values. Browser HyperFormula output cannot be
trusted as a durable scientific result, and an otherwise valid cached value can
become obsolete after a UI edit, direct REST edit, formula change, or schema
change.

## Decision

Sheetbase stores optional formula result caches separately from formula
definitions in `internal.formula_result_cache`. Each cache records the exact
formula version, notebook `calculation_input_revision`, every active table's
schema version, result kind, typed JSON scalar or structured error, calculation
status and timestamp, HyperFormula version, semantic profile fingerprint, and
Node runtime fingerprint. The semantic fingerprint is pinned to
`fnv1a32-0c96cef0` for the HyperFormula 3.3.0 profile accepted by ADR 0021.

The PostgREST resource `api.formula_results` is a security-invoker view over the
RLS-protected definition, record, and internal cache relations. It derives one
of these consumer states:

- `pending`: no cache exists;
- `current`: formula version and input revision match a completed value or
  structured calculation error;
- `stale`: a cache exists but either revision no longer matches;
- `failed`: the controlled worker failed at the matching revision;
- `unavailable`: the formula profile is unsupported at the matching revision.

`calculated_value` is projected only for a current value result. It is SQL null
for stale, failed, unavailable, pending, and structured-error states. Consumers
must inspect `calculation_status`; cached stale scalars are not exposed through
the public view. The view labels these cells as formulas and states explicitly
that the result value is not authoritative. Generated row resources continue
to expose literals plus formula markers, never substituted calculations.

The authenticated `POST /api/calculations` path is the controlled Node worker.
It reads one complete notebook under a repeatable-read snapshot, validates all
generated identifiers, reconstructs the workbook from durable definitions and
stable identities, computes every formula with the pinned profile, and submits
the entire result set through the `formula_writer` capability. The database
locks the record and compares the claimed input revision and complete current
formula ID/version set before replacing any cache. A mismatch writes nothing.

Workbook reconstruction or evaluation failure writes one safe, revision-bound
failed state for all supported formulas and an unavailable state for unsupported
ones. A database commit or compare-and-swap failure is not reclassified as a
worker failure. Completion and failure each emit one `calculation` durable event
containing only record ID, revision, and status.

UI edits invoke controlled recalculation after their PostgreSQL transaction.
Notebook load and durable row/formula/schema events rebuild the browser workbook
and invalidate result queries. Direct REST edits atomically advance the input
revision in PostgreSQL, so the public view becomes stale even if no browser is
connected; an authenticated recalculation request advances it back to current.
The formula bar exposes the trusted state and an explicit recalculation action.

## Consequences

- API clients can distinguish definitions, current results, errors, stale data,
  and unavailable calculations without treating a cache as source data.
- Staleness requires no eager cache update and cannot race the authoritative
  mutation: it is derived from revision inequality.
- Calculation is currently request-driven rather than a durable background
  queue. A later worker may call the same compare-and-swap function without
  changing the persistence or API contract.
- Full-notebook calculation and conservative result replacement cost more than
  per-cell writes but prevent partial scientific result sets.
