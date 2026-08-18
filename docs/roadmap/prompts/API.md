# Prompt — API & Developer Platform

Work on the **assigned API stream** in `phlohouse/sheetbase-eln`. Read `docs/roadmap/NEXT.md` first. Do not implement DATA-01, PC-03, GOV-02, remaining PLAT-03, or unassigned API epics in an API session.

## Authority

Branch from current `main` unless `NEXT.md` specifies another base. Read `NEXT.md`, `tasks/API.md`, `docs/public-api-contract.md`, accepted PC-00 decisions in `audits/PC-00.md`, existing external API documentation/code, Core RPC/RLS contracts and relevant ADRs before editing.

## Current assigned task (when NEXT.md says API-07)

**API-07 — Core External Allowlist Cut-over (Medium).** API-01 and API-02 are complete. Stay on the external allowlist / scope-enforcement cut-over.

- Map canonical Core-domain scopes onto the Dataset/Sheet/Notebook RPCs the product already uses (`src/lib/external-token.ts`, plus `api_client` RLS/grants if required).
- Keep fail-closed unknown paths. Do not expose every `api.*` function.
- Keep `schema:*` distinct from `datasets:*`. `sheets:write` does not author Sheet Definitions.
- Do not invent a second permission model. Do not restore scientific-table REST.
- Do not implement API-03 (OpenAPI), personal tokens, named service-account principals, or credential activity-audit events in this epic.

## Objective

Make Sheetbase a deliberate programmable platform rather than exposing internal PostgreSQL/PostgREST details as the public integration contract.

The browser, SDKs, integrations, future Pipelines and future agents should converge on the same domain operations wherever practical.

## Principles

- public resources use stable domain identity, not SQL table names as accidental API design;
- stable errors, pagination, filtering, concurrency and idempotency are explicit contracts;
- external clients never bypass RLS/capabilities/validation/provenance;
- credentials are scoped, attributable, revocable and auditable;
- OpenAPI/docs are kept aligned with implementation;
- Python ergonomics matter for scientific users;
- pre-release work removes superseded development-era contracts rather than keeping compatibility shims, unless an explicit current dependency requires otherwise.

## Working method

Implement only the assigned API epic. Audit existing PostgREST/RPC/external allowlist paths first. Reuse Core operations rather than wrapping unsafe direct writes. Add contract/security tests and documentation where the Low boundary allows.

## Do not

Do not create an API-specific data model, API-only permissions, or agent-only privileged endpoints. Do not start Pipelines. Do not expose privileged internal RPCs merely because they exist.

## Completion

Meet the assigned task's exit criteria, update evidence and `NEXT.md` for the API stream, and report API surface, auth/security model, compatibility implications, tests and remaining queued implementation.
