# Roadmap 3 Tasks — Institutionalise

## Programme outcome

Support larger and more regulated deployments when real adoption justifies the complexity, without changing the fundamental scientist-facing product model.

---

## ENT-ORG-01 — Organisation & Team Model

### Problem

Workspace membership is sufficient today. Larger deployments may require organisation/team structure, delegated administration and ownership boundaries, but adding hierarchy prematurely risks destabilising RLS and product simplicity.

### Scope

- only begin after a concrete deployment need and an accepted ADR;
- define organisation/team/workspace relationships and ownership semantics;
- delegated administration and membership management where justified;
- preserve existing workspace-scoped capabilities unless the ADR deliberately changes them;
- migration from current workspace model only for actual stored state that exists at that time;
- ensure SDK/API/integration principals resolve organisation/workspace context consistently.

### Non-goals

- enterprise hierarchy for its own sake;
- changing scientific object identity to human-readable hierarchy paths;
- duplicating workspace capability systems;
- speculative multi-tenant billing structures.

### Dependencies

ADMIN-01 and an accepted ADR. This task supersedes the deferred Roadmap 2 GOV-02 concept only when activated.

### Required evidence

- RLS/isolation proofs across organisation/team/workspace boundaries;
- delegated-admin capability tests;
- existing single-workspace flows remain simple;
- API/SDK principal resolution tests.

### Exit criterion

A justified organisation/team model supports larger deployments with explicit ownership and delegated administration while preserving strong isolation and coherent workspace-scoped scientific semantics.

---

## GXP-01 — Configurable Regulated Controls & Evidence

### Problem

Sheetbase already has strong identity, revisions, auditability and frozen evidence. Regulated deployments may require configurable controls and evidence packages, but the product should not impose compliance theatre on all users.

### Scope

- configurable policies for review/signature/approval/evidence behaviours built on existing revision/sign/amend contracts;
- explicit intended-use/configuration boundaries rather than blanket "GxP mode" claims;
- stronger evidence export/reconstruction where needed;
- controlled configuration/change history for relevant governed settings;
- retention/locking policies only where they map to canonical version/evidence semantics;
- administrator/quality visibility into enabled controls;
- validation/evidence documentation hooks for deployers without embedding organisation-specific SOPs into product logic.

### Non-goals

- claiming regulatory compliance solely from software features;
- replacing customer quality systems/SOPs;
- making exploratory work impossible;
- converting audit history into frozen evidence;
- hard-coding one jurisdiction's workflow everywhere.

### Dependencies

ADMIN-01; existing revision/e-signature/evidence contracts. ENT-ORG-01 only if organisation scope is required by an actual deployment.

### Required evidence

- policy enforcement at server/DB boundaries;
- signature/review/evidence reconstruction tests;
- controlled-setting change audit tests;
- proof that disabled controls do not burden ordinary non-regulated workflows.

### Exit criterion

Deployers can configure and prove appropriate regulated-control behaviours over Sheetbase's canonical evidence/revision model without turning compliance into a parallel product architecture or misleading blanket claim.

---

## OPS-01 — Institutional Operational Maturity

### Problem

Broader adoption requires stronger scale, resilience and operational administration than the initial deployment baseline, but operational work should follow measured product needs.

### Scope

- capacity/concurrency/performance targets derived from real adoption;
- backup/restore/DR maturity and regularly tested recovery evidence;
- stronger deployment/upgrade observability and failure recovery;
- operational quotas/limits where necessary and visible to admins;
- storage/database lifecycle management;
- security hardening and dependency/SAST posture appropriate to deployment scale;
- supportability diagnostics without leaking scientific data/secrets;
- documented operational SLOs only where the system can measure them.

### Non-goals

- infrastructure rewrites without measured need;
- distributed systems complexity for prestige;
- replacing canonical PostgreSQL authority without a proven bottleneck;
- platform metrics dashboards detached from actionable operations.

### Dependencies

ADMIN-01 and adoption/performance evidence. May proceed incrementally where concrete operational risks already exist.

### Required evidence

- representative load/concurrency tests;
- tested restore/DR exercise;
- deploy/rollback/failure-path tests;
- security/secret boundary checks;
- operational runbooks reflecting actual architecture.

### Exit criterion

Sheetbase can be operated at demonstrated institutional scale with tested recovery, observable deployment/runtime behaviour and explicit capacity/security limits, without unnecessary architectural complexity.
