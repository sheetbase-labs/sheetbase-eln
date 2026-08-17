# GOV — Identity, Administration & Governance

**Status:** GOV-01 complete (`#45` / `1256258`). `viewer` is read-only. GOV-02 requires an ADR.

## Programme goal

Make Sheetbase governable at organisational scale while keeping normal scientific work lightweight.

## GOV-01 — Role & Capability Productisation

**Priority:** medium (RLS/migration). **Status:** Complete (`#45` / `1256258` on `main`).

### Accepted PC-00 decision

**`viewer` means read-only.**

Existing `viewer` memberships stay `viewer` and cannot mutate. Member-class data capabilities (`record.create`, `record.link`, `instance.upgrade`) belong to owner/admin/member/steward/scientist/analyst/reviewer.

Delivered:

- existing `viewer` members stay `viewer` and lose mutate capabilities;
- RLS and `api.has_capability` / role-mapping semantics, kept in agreement with the TypeScript mirror;
- permission regression tests across session and `api_client` paths;
- invitation role copy;
- documentation of remaining unused roles (`scientist`, `analyst`, `reviewer`) as member-class.

`schema.edit` and `schema.publish` still share steward/admin/owner. Keep the trigger split; do not claim a two-person rule until product requires it.

Do not jump directly to arbitrary custom RBAC policy languages.

**Exit:** administrators and users can understand who can do what; `viewer` cannot mutate; UI/API/server enforcement agree.

**Evidence:** `0111`/`0112`, `api.is_workspace_writer`, leftover-inventory abort, `tests/db/gov-01-viewer-readonly.test.ts`, full DB suite, migrate+seed proof (`#45`).

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
- Do not silently tighten `viewer` as a side effect of PC-01.
