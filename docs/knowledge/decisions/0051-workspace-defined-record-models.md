# 0051. Workspace-defined record models

- **Status:** accepted
- **Date:** 2026-09-27
- **Ticket:** Roadmap 4, MDL-01 (DEC-07)
- **Amends:** ADR-0026 scientific record kinds and configurable properties

## Context

ADR-0026 makes samples, reagents and protocols record kinds whose scientific
content is configurable typed properties, with new kinds added by widening a
fixed `records.kind` check constraint. The v3 design goes further
(`canvas/ModelFields.dc.html`, `canvas/SchemasList.dc.html`,
`canvas/ModelVersions.dc.html`): a workspace can define its own **model** —
"Cell bank" (`MDL-0019`, prefix `CB-`) with fields, rules and versions — and
edit it as a draft version while the published version stays in use until
approved. Records link to other models (Storage location, Cell bank). The
design also shows a Materials registry (`canvas/MaterialsList.dc.html`).

The open question is where a workspace-defined model is stored: a generic record
host, or a table per model.

## Decision

1. **Generic record host.** Workspace-defined kinds are stored in the existing
   `records` infrastructure, not a table per model. A new workspace-owned
   `record_models` table holds each model's identity (workspace, key, name,
   identifier prefix, lifecycle, current published version); the existing
   `record_field_definitions` gain a model/version dimension for fields, units,
   types and rules.
2. **Versioned schemas with approval.** A model's fields, rules and prefix are a
   versioned definition. Edits create a draft version; the published version
   stays in use until the draft is approved (MDL-03). Records keep the model
   version they were created under; adding a field is additive and never
   rewrites recorded values. `records.kind` becomes a workspace-scoped reference
   to a model rather than a fixed global enum, so a workspace can define a kind
   without a migration.
3. **Built-in models stay built-in.** The existing kinds (sample, reagent,
   protocol_template, experiment, report) are seeded as built-in models in every
   workspace and are not editable or deletable. **Cell banks are
   workspace-defined models** (the design defines `CB-` with its own fields and
   rules). **Materials are built-in**, not workspace-defined: the design treats
   the materials registry as a fixed lab concept (LAB-04).
4. **Canonical everywhere.** A record of a workspace model is a normal record:
   workspace-scoped RLS, change events, audit attribution, `record_links`,
   revisions, search indexing and the public API treat it exactly like a
   built-in record. Search indexes field labels/values; lineage uses
   `record_links`; the API exposes the model definition and its records through
   the same `/api/db` boundary.
5. **RLS test plan.** Prove: a member reads only their workspace's models and
   records; another workspace's model and records are invisible; only an
   authorised role publishes a model version; a record written under an older
   version remains readable after a new version is published.

## Consequences

- A workspace-definable kind costs no migration per kind; the model definition
  is data, the validation trigger reads it at write time (ADR-0026 §2 pattern).
- The fixed `records.kind` check constraint is replaced by the workspace-scoped
  model reference; existing rows map to the seeded built-in models.
- Materials remain a built-in model; if a workspace later needs custom material
  fields, that is a built-in-model field extension, not a new model.
- MDL-02/03/04 build the editor, approval and generated record pages on this
  host; no parallel record system is introduced.

## Alternatives considered

- **Table per model.** Rejected: it forks identity, RLS, events, audit, links
  and search for every workspace kind, and cannot be created at runtime.
- **Fixed enum widened by migration per kind.** Rejected: the design lets a
  workspace define a model without a deployment, and Cell bank is not globally
  meaningful.
- **Workspace-defined materials.** Rejected for now: the design's materials
  registry is a fixed lab concept (LAB-04), unlike Cell bank.
