# OPS — Institutional Operational Maturity

**Status:** planned and adoption-gated.

## Programme goal

Mature Sheetbase operations for larger institutional deployments without letting infrastructure work displace scientist-facing product value.

## OPS-01 — Capacity, SLOs & Scale Validation

### Goal

Define and prove operational expectations at larger scale.

### Scope

- service-level objectives for availability/latency/recovery;
- larger workspace/user/data/concurrency scenarios;
- capacity budgets and bottleneck tests;
- documented limits and failure modes;
- no silent scientific truncation to meet performance targets.

### Exit

Target institutional workloads have explicit SLOs/limits and repeatable load/capacity evidence.

## OPS-02 — Resilience, Backup & Disaster Recovery

### Goal

Prove recoverability of authoritative scientific state and platform services.

### Scope

- backup encryption/retention/restore verification;
- recovery objectives and runbooks;
- object/file/database consistency;
- restore tests for version/evidence integrity;
- dependency failure scenarios.

### Exit

A documented recovery exercise restores representative Sheetbase state within target objectives and proves scientific versions/evidence remain coherent.

## OPS-03 — Operational Security & Enterprise Observability

### Goal

Mature security/observability controls required for institutional operation.

### Scope

- security monitoring and actionable alerts;
- SAST/dependency/container/configuration scanning where justified;
- rate/abuse controls across relevant public surfaces;
- central operational diagnostics and incident evidence;
- periodic access/integration health review support.

### Exit

Operators can detect, investigate and respond to representative security/availability incidents using supported telemetry and runbooks.

## Boundaries

- Infrastructure maturity follows real deployment needs and explicit SLOs.
- Operational telemetry does not become scientific/audit evidence.
- Do not degrade canonical security/evidence semantics to improve operational convenience.
