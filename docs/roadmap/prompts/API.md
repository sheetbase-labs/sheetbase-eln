# Prompt — API & Developer Platform

Work on the active **API — API & Developer Platform** epic in `phlohouse/sheetbase-eln`.

## Authority

Branch from current `main` unless `docs/roadmap/NEXT.md` specifies another base. Read `NEXT.md`, `tasks/API.md`, PC-00 findings, existing external API documentation/code, Core RPC/RLS contracts and relevant ADRs before editing.

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

Implement only the active API epic. Audit existing PostgREST/RPC/external allowlist paths first. Reuse Core operations rather than wrapping unsafe direct writes. Add contract/security tests, documentation and SDK tests where applicable. Verify browser and external paths do not diverge scientifically.

## Do not

Do not create an API-specific data model, API-only permissions, or agent-only privileged endpoints. Do not start Pipelines. Do not expose privileged internal RPCs merely because they exist.

## Completion

Meet the active task's exit criteria, update evidence and `NEXT.md` as appropriate, and report API surface, auth/security model, compatibility implications, tests and remaining risks.
