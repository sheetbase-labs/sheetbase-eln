# ENT-ORG — Organisation & Team Model

**Status (2026-09-07):** ENT-ORG-01 has proposed ADR-0044 from merged #162; its accepted-ADR exit is **not met**. ENT-ORG-02/03 are explicitly deferred. This does not reactivate GOV-02 or authorise ownership/RLS changes. See the [reconciled status index](README.md) and [`../../NEXT.md`](../../NEXT.md).

## Programme goal

Support multi-workspace organisational structure only when real adoption requires it, without weakening current workspace isolation.

## ENT-ORG-01 — Organisation Domain ADR

### Goal

Resolve the organisation/team domain model before implementation.

### Scope

- organisation, workspace and team ownership semantics;
- membership/invitation and role inheritance options;
- service credentials/integrations ownership implications;
- RLS and migration impact;
- explicit non-goals and adoption evidence.

### Exit

An accepted ADR defines the organisation/team ownership and security model with no unresolved ambiguity about workspace authority.

## ENT-ORG-02 — Organisation Membership & Workspace Governance

### Goal

Implement the accepted organisation/workspace membership model.

### Scope

- organisation/workspace membership lifecycle;
- invitations and role assignment;
- organisation-level versus workspace-level capabilities;
- server/RLS enforcement and cross-org isolation;
- administration UI/API.

### Exit

Organisation membership can govern multiple workspaces according to the ADR while existing workspace-scoped security remains fail-closed.

## ENT-ORG-03 — Teams, Shared Configuration & Organisation Operations

### Goal

Add only the team/shared-configuration capabilities proven necessary by institutional use.

### Scope

- teams/groups if justified by the ADR/use cases;
- assignment/discovery of shared organisational configuration;
- organisation-level administration and lifecycle;
- audit/operational visibility;
- scale/performance tests for larger memberships.

### Exit

Required institutional organisation/team workflows work end-to-end without creating duplicate scientific configuration authorities.

## Boundaries

- No implementation before the ADR and concrete adoption need.
- Organisation hierarchy must not silently broaden workspace access.
- Steward scientific configuration and platform administration remain distinct responsibilities.
