# Prompt — API & Developer Platform

Work on the **assigned API stream** in `phlohouse/sheetbase-eln`. Read `docs/roadmap/NEXT.md` first. Do not implement DATA-01, PC-03, GOV-02 or remaining PLAT-03 in an API session.

## Authority

Branch from current `main` unless `NEXT.md` specifies another base. Read `NEXT.md`, `tasks/API.md`, `docs/public-api-contract.md`, accepted PC-00 decisions in `audits/PC-00.md`, existing external API documentation/code, Core RPC/RLS contracts and relevant ADRs before editing.

## Current assigned task (when NEXT.md says API-02)

**API-02 — API Credentials & Service Identity (Low).** API-01 is complete. Stay on credentials/service identity against the published contract.

- Reuse `schema:*` vs `datasets:*` vs `sheets:write` from contract v0.1.1.
- Productise credential create/list/revoke/rotation/attribution where missing.
- Do not invent a second permission model.
- Core Dataset/Sheet RPC allowlist remains fail-closed. If cutting it over is Medium (migrations/RLS/transactions), **stop and queue** that work.

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
- backwards compatibility/deprecation is deliberate once a public contract exists.

## Working method

Implement only the assigned API epic. Audit existing PostgREST/RPC/external allowlist paths first. Reuse Core operations rather than wrapping unsafe direct writes. Add contract/security tests and documentation where the Low boundary allows.

## Do not

Do not create an API-specific data model, API-only permissions, or agent-only privileged endpoints. Do not start Pipelines. Do not expose privileged internal RPCs merely because they exist.

## Completion

Meet the assigned task's exit criteria, update evidence and `NEXT.md` for the API stream, and report API surface, auth/security model, compatibility implications, tests and remaining queued implementation.
