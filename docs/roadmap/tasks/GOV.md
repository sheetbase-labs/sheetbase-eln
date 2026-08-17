# GOV — Identity, Administration & Governance

**Status:** planned; refine after PC-00.

## Programme goal

Make Sheetbase governable at organisational scale while keeping normal scientific work lightweight.

## GOV-01 — Role & Capability Productisation

Clarify role semantics; make viewer genuinely meaningful when deliberately changed; role/capability UI; effective-permission inspection; invitation role selection; permission-denied UX; capability documentation; tests across browser/API.

Do not jump directly to arbitrary custom RBAC policy languages.

**Exit:** administrators and users can understand who can do what, and UI/API/server enforcement agree.

## GOV-02 — Organisation Model

Organisation identity; workspace membership; organisation membership; organisation-owned configuration where justified; workspace boundaries; shared Models/vocabularies/policies; invitation/admin flows; migration from current workspace ownership; RLS model.

Requires an ADR before changing ownership/RLS architecture.

**Exit:** multi-workspace organisations can share intended configuration without weakening isolation.

## GOV-03 — Audit & History Experience

Object timelines; actor/time/action; before/after where meaningful; provenance links; filtering; search; export; correlation across multi-object operations; administrator/scientist views.

**Exit:** users can answer who changed what, when and through which operation without reading raw database events.

## GOV-04 — Electronic Records, Review & Signatures

Build on REV-002: review states; signature meanings; re-authentication; reasons; manifestations; amendments/reopen; controlled invalidation; evidence packages; retention/export; policy configuration.

Regulatory claims require separate validation/compliance work; product features alone do not make the system compliant.

**Exit:** controlled review/signature workflows preserve frozen evidence and understandable signature context.

## Boundaries

- Keep capabilities server-authoritative.
- Do not put capability grants into JWT claims as a shortcut.
- Do not make every exploratory action approval-gated.
- Separate product controls from claims of regulatory compliance.
