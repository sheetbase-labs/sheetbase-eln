# Prompt — API & Developer Platform

Work on the **assigned API stream** in `phlohouse/sheetbase-eln`. Read `docs/roadmap/NEXT.md` first. Do not implement PC-01, DATA-01, GOV-01 or PLAT-03 in an API session.

## Authority

Branch from current `main` unless `NEXT.md` specifies another base. Read `NEXT.md`, `tasks/API.md`, accepted PC-00 decisions in `audits/PC-00.md`, existing external API documentation/code, Core RPC/RLS contracts and relevant ADRs before editing.

## Current assigned task (when NEXT.md says API-01)

**API-01 — Public API Contract (Low).** Parallel with PC-01. Stay **contract / audit / documentation**.

Produce:

- canonical public resource/operations contract;
- Core-domain scope proposal (retire `scientific:*` as the future model);
- compatibility/deprecation plan if real clients depend on old scopes;
- corrections to stale `docs/external-api.md`.

Inspect the actual server/API implementation (`src/lib/external-token.ts`, token exchange, `/api/db` proxy, grants). Do not restore scientific-table architecture.

If implementation requires consequential server architecture, migrations, RLS, transactions or other Medium-level work, **stop at the contract boundary** and queue that work separately.

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

Do not create an API-specific data model, API-only permissions, or agent-only privileged endpoints. Do not start Pipelines. Do not expose privileged internal RPCs merely because they exist. Do not cut over a new allowlist/RLS design if that is Medium work — document it and stop.

## Completion

Meet the assigned task's exit criteria, update evidence and `NEXT.md` for the API stream, and report API surface, auth/security model, compatibility implications, tests and remaining queued implementation.
