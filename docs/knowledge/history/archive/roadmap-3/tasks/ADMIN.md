# ADMIN — Mature Platform Administration

**Status (2026-09-07):** ADMIN-01..03 implementation merged on `main` (#150..152). See the [reconciled status index](README.md); merged is not independent acceptance of every exit. Current assignment is owned by [`../../NEXT.md`](../../../../NEXT.md).

## Programme goal

Give workspace administrators a coherent operational view of configuration, access, integrations and platform health without mixing Steward scientific configuration with platform administration.

## ADMIN-01 — Administration Information Architecture

### Goal

Clarify the boundaries and navigation of administration versus scientific configuration.

### Scope

- consolidate admin destinations;
- keep Steward data-language configuration under the canonical configuration surface;
- separate security/platform operations from scientific modelling;
- consistent permission gating and deep links.

### Exit

Administrators and Stewards can distinguish where each class of configuration belongs, with no duplicate authority across `/admin`, `/configure` or settings surfaces.

## ADMIN-02 — Access, Credentials & Integration Operations

### Goal

Provide one operational view of members/roles, API credentials, connectors, webhooks and extension installations.

### Scope

- lifecycle/status/last-used or last-run metadata;
- revoke/rotate/disable actions through canonical server operations;
- audit/activity links;
- fail-closed permission controls.

### Exit

An administrator can inspect and manage all externally acting identities/integrations from coherent platform surfaces without database access.

## ADMIN-03 — Platform Health, Quotas & Diagnostics

### Goal

Expose actionable platform health and operational diagnostics.

### Scope

- storage/usage and relevant limits;
- failed connector/Pipeline/webhook jobs;
- security/configuration warnings;
- links into observability/runbook actions where appropriate;
- avoid dashboard-card theatre without actionable meaning.

### Exit

Administrators can identify material workspace/platform problems and navigate to corrective actions from supported UI/API surfaces.

## Boundaries

- Administration does not become a second scientific configuration product.
- UI visibility never substitutes for server/RLS/capability enforcement.
- Operational metrics do not redefine scientific/audit evidence.
