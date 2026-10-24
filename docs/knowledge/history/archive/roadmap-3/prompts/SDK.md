# Prompt — SDK

Work only on the assigned SDK task in `tasks/SDK.md` after Roadmap 2 API-04/05 are complete and root `NEXT.md` activates it. Read the public API contract, OpenAPI, initial SDKs and relevant API ADRs first.

SDKs wrap the public domain contract; they do not copy business logic or expose private PostgREST resources. Preserve stable errors, identity, pagination, idempotency and version semantics.

Meet the assigned exit criterion with public-contract parity and package-level integration tests. Do not start the next SDK task implicitly.
