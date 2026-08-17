# PLAT — Platform, Operations & Security

**Status:** continuous; refine priority after PC-00.

## Programme goal

Make Sheetbase reliable, observable, secure and operable as usage and organisational criticality grow.

## PLAT-01 — Deployment & Environment Maturity

Environment separation; immutable artifacts; migration strategy; deployment gates; rollback; secret injection; backups; restore drills; disaster recovery objectives; feature flags where justified.

**Exit:** releases and recovery are repeatable and documented rather than operator-dependent.

## PLAT-02 — Observability & Reliability

Structured logs; metrics; traces where useful; request correlation; DB/RPC latency; error rates; background/integration run visibility; health/readiness; alerts; SLOs after usage data exists.

**Exit:** failures can be detected and diagnosed without reproducing them interactively.

## PLAT-03 — Security Hardening

CSP/security headers; rate limits; secret management; dependency/vulnerability scanning; SAST; auth/session review; API abuse controls; backup encryption; audit of SECURITY DEFINER/RLS/grants; penetration testing at appropriate maturity.

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
