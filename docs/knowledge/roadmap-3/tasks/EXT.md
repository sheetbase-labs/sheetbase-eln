# EXT — Extension Model

**Status (2026-09-07):** EXT-01..03 bounded implementation merged on `main` (#147..149). This is not a claim of an external plugin marketplace or independently verified deployment trust. See the [reconciled status index](README.md) and [`../../NEXT.md`](../../NEXT.md); original exits remain unchanged.

## Programme goal

Provide a deliberate way to extend Sheetbase without allowing plugins/integrations to create shadow domain models or bypass security.

## EXT-01 — Extension Contract & Capability Boundaries

### Goal

Define what an extension is allowed to contribute and which canonical contracts it may use.

### Scope

- extension metadata/identity/lifecycle;
- declared capabilities and permission checks;
- allowed UI, command, automation and data-access contribution points;
- server-side enforcement and workspace scoping;
- installation/enable/disable semantics.

### Exit

An extension contract exists that makes authority, permissions and lifecycle explicit before any general plugin ecosystem is built.

## EXT-02 — UI & Command Extension Points

### Goal

Allow bounded product extensions without arbitrary application mutation.

### Scope

- registered object/context actions;
- panels/views where justified;
- command palette/action integration;
- design/accessibility constraints;
- no direct ownership of canonical scientific state.

### Exit

A sample extension can add a useful contextual UI/action through supported extension points without importing private application internals.

## EXT-03 — Distribution, Trust & Compatibility

### Goal

Make extension installation and upgrades governable.

### Scope

- package/source identity and versioning;
- compatibility declarations;
- trusted/admin installation controls;
- update/disable/remove flows;
- audit/diagnostic information for extension actions.

### Exit

Administrators can understand what an extension can do, install/update/remove it safely, and detect incompatible versions.

## Boundaries

- Canonical Models, Datasets, Sheets, Pipelines and capabilities remain authoritative.
- Extensions use public/extension contracts, not private database tables or hidden browser state.
