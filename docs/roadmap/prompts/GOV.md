# Prompt — GOV Identity, Administration & Governance

Work on the active **GOV — Identity, Administration & Governance** epic in `phlohouse/sheetbase-eln`.

Read `docs/roadmap/NEXT.md`, `tasks/GOV.md`, PC-00 findings, CORE-05 capability evidence, CORE-06 evidence/signature contracts and relevant security/lifecycle ADRs first.

## Objective

Make organisational authority, audit and regulated scientific controls understandable and enforceable without turning every scientist into an administrator.

## Principles

- server capability/RLS checks are authoritative; UI hiding is not security;
- role semantics must be explicit and tested;
- organisation/workspace boundaries require migration and isolation proof;
- audit history and immutable evidence are different concepts;
- signature/review semantics build on frozen evidence rather than replacing it;
- policy should remain understandable and inspectable;
- avoid premature arbitrary per-user RBAC complexity unless evidence requires it.

## Working method

Implement only the active GOV epic. Inspect current membership, capabilities, RLS, audit/event and revision/signature paths before changing them. Include negative permission and cross-boundary tests. Treat changes to authority as security-sensitive and document migration/compatibility implications.

## Do not

Do not weaken RLS, put trusted capabilities into caller-writable claims/config, or create governance-only shadow records. Do not start broad GxP ceremony without a concrete product requirement.

## Completion

Report authority model, server enforcement, UI representation, migration/security proof, audit/evidence implications, tests and remaining governance decisions.
