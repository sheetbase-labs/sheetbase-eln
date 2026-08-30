# PLAT — Platform, Operations & Security

**Status:** continuous. PLAT-03 **headers slice** is complete (`#43`). Remaining PLAT-03 work is queued. Health/ready already exist.

## Programme goal

Make Sheetbase reliable, observable, secure and operable as usage and organisational criticality grow.

## PLAT-01 — Deployment & Environment Maturity

Environment separation; immutable artifacts; migration strategy; deployment gates; rollback; secret injection; backups; restore drills; disaster recovery objectives; feature flags where justified.

**Exit:** releases and recovery are repeatable and documented rather than operator-dependent.

## PLAT-02 — Observability & Reliability

Structured logs; metrics; traces where useful; request correlation; DB/RPC latency; error rates; background/integration run visibility; health/readiness; alerts; SLOs after usage data exists.

PC-00: `/api/health/live` and `/ready`, request ids, JSON logs with redaction already exist (`docs/observability.md`). Do not rebuild that. Add metrics when traffic justifies them. Rewrite `docs/external-api.md` in **API-01**, not here.

**Exit:** failures can be detected and diagnosed without reproducing them interactively.

## PLAT-03 — Security Hardening

**Priority:** low initially. **Status:** Headers slice complete (`#43` / `3c3c8ee`). Remainder queued.

CSP/security headers; rate limits; secret management; dependency/vulnerability scanning; SAST; auth/session review; API abuse controls; backup encryption; audit of SECURITY DEFINER/RLS/grants; penetration testing at appropriate maturity.

**Headers slice:** application security headers and transitional CSP (documented `unsafe-inline`) shipped in `#43`. Credential exchange is rate-limited; general API is not. Remaining items above are not started. H1 capability-mask is fail-closed for `authenticated`. `viewer` read-only is GOV-01 (`#45`).

**Exit:** major application/platform security controls are deliberate, tested and observable.

## PLAT-04 — Platform Administration

Workspace/org administration; users; service accounts; storage/API usage; connector health; audit access; feature state; support diagnostics; quotas only when needed.

**Exit:** operators can understand and administer a deployment without database access for routine tasks.

## PLAT-05 — Performance & Scale

Large Sheets/Datasets; query latency; paste/import throughput; Notebook load; composition; search; concurrency; connection pools; caching; database indexes; load tests; representative scale gates.

**Exit:** performance expectations are explicit and validated against realistic scientific workloads.

## Boundaries

- Do not optimise speculative bottlenecks without measurement.
- Security controls must not rely only on UI hiding.
- Backups are incomplete until restore is proven.
- Observability must avoid leaking sensitive scientific content unnecessarily.
