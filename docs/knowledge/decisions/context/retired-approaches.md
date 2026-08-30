---
title: Retired Sheetbase Approaches
status: retired
last_reviewed: 2026-08-30
---

# Retired Sheetbase Approaches

This file exists to stop superseded development-era ideas from being accidentally reintroduced.

## Separate “table” product

**Retired:** treating tables as a top-level product distinct from Sheets.

**Canonical:** a table-like structured interaction surface is a Sheet. There is one Sheet product with different states/configurations.

## Legacy scientific-table architecture

**Retired:** `scientific_tables`, generated `sheet_*` resources and SCI-010/scientific-table product/API surfaces as the future architecture.

The underlying physical remnants may temporarily exist only where current canonical dependencies still require them, but they must not regain UI, app-write or external-API authority.

**Canonical:** Sheet Instances and canonical Datasets/fields/rows.

## `scientific:*` public credential scopes

**Retired:** scientific-specific scope vocabulary.

**Canonical:** the API-01 canonical data/schema/sheet/etc. scope vocabulary with fail-closed allowlisting.

## Browser-only domain semantics

**Retired:** implementing important scientific behaviour solely as React-local configuration/state with no canonical domain/API representation.

**Canonical:** browser is one client; durable artefacts use canonical server/domain contracts.

## Generic Sheet Version

**Rejected:** versioning the entire Sheet as the default evidence primitive.

**Why:** a Sheet is a compositional interaction surface that can include local/presentational state. Dataset Version plus explicit evidence configuration preserves scientific meaning more cleanly.

## Auto-promotion of local fields

**Rejected:** automatically turning exploratory Sheet columns into governed Dataset/Model schema.

**Canonical:** explicit promotion.

## Shared mutable reusable instances

**Rejected:** Notebook Templates or Sheet Definitions behaving like mutable parents that silently change existing work.

**Canonical:** pinned/versioned reusable configuration and explicit upgrade semantics.

## Hidden Definition inheritance

**Rejected/deferred:** deep inheritance chains for reusable scientific configuration.

**Canonical:** explicit composition, Templates, Definitions and parameters.

## Parallel workflow/automation systems

**Rejected:** adding a new workflow substrate for each automation use case.

**Canonical:** AUTO Pipeline definition/version/run model.

## Specialist integration architecture first

**Rejected:** designing the integration layer around a single instrument/vendor.

**Canonical:** generic connector framework with specialist implementations.

## Compatibility shims for hypothetical users

**Retired during pre-release:** aliases, dual reads/writes, migration layers and compatibility-only tests whose only purpose is preserving superseded development history.

**Reason:** there are no production users/data requiring those contracts.

## Organisation hierarchy as an incidental feature

**Rejected as side-effect work:** casually introducing organisation/team ownership semantics from unrelated tasks.

**Canonical:** GOV-02 requires a dedicated ADR and product justification.

## SCI-04 as optional polish

**Corrected:** scientific visualisation was briefly treated as deferrable product depth after SCI-01–03.

That prioritisation was corrected. Scientific graphing is a core Sheetbase workflow, and SCI-04 was completed as Roadmap 2 core product work.

## Ecosystem/Phlo-led Sheetbase roadmap

**Rejected framing:** organising future Sheetbase priorities around serving another project or ecosystem.

**Canonical:** mature Sheetbase for its own users. Generic interoperability remains valuable but should not drive product priorities.
