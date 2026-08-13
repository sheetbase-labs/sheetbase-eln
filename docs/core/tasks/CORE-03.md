# CORE-03 — Compositional Sheet

**Status:** Planned / task skeletons  
**Refinement gate:** CORE-02.8 must elaborate these tasks using implemented Dataset contracts.  
**Normative reuse decision:** `docs/decisions/0020-sheet-definitions-instances-and-template-reuse.md`.

## Epic goal

Implement the Sheet layer as two separate primitives:

1. **Sheet Definition** — reusable, versioned composition/configuration.
2. **Sheet Instance** — working spreadsheet with resolved sources, local values and provenance.

A Sheet Instance can combine multiple Datasets and Model Records plus local and calculated columns.

## Invariants

- Definitions never own experiment-specific local values.
- Datasets remain independently reusable.
- Multiple Notebook Templates may reference the same Definition version.
- Creating two Instances from one Definition does not share local values.
- Existing Instances remain pinned to their source Definition version unless explicitly upgraded.
- Template references are pinned to Definition versions by default.
- Shared live Instances are explicit, not accidental.
- Row identity, joins and write-back are explicit.
- Every writable value has one authoritative target.
- Formula dependencies use stable semantic identities beneath A1 display.

## Planned tasks

### CORE-03.1 — Audit current Sheet and Template persistence

Map current Sheet blocks/tables, Templates, Handsontable state, formula binding and persistence into Definition versus Instance responsibilities.

**Output:** `docs/core/audits/SHEET_COMPOSITION_AUDIT.md`.

### CORE-03.2 — Sheet Definition identity and versioning

Implement durable versioned Definitions containing input/binding specifications, row identity, joins, columns, calculations, write-back rules and configured actions.

### CORE-03.3 — Sheet Instance identity and resolved bindings

Implement working Instances with optional source Definition/version, Notebook/project context, resolved Dataset/Model bindings, local fields/values and provenance.

### CORE-03.4 — Parameterised bindings

Allow a Definition to require compatible inputs, such as a Dataset using a specified Dataset Schema, rather than hard-coding a Dataset instance.

### CORE-03.5 — Row identity

Implement source, composite and local row identities. Visual row positions are never durable identities.

### CORE-03.6 — Constrained joins

Implement explicit equality joins and cardinality checks. Unexpected many-to-many expansion must be surfaced.

### CORE-03.7 — Bound columns and provenance

Resolve Definition columns against Instance sources while keeping source, Definition/version and write target inspectable.

### CORE-03.8 — Instance-local columns

Persist typed local fields/values on the Instance. Definitions may predefine local-column semantics, but values remain Instance-specific. Support later promotion into governed/reusable definitions.

### CORE-03.9 — Calculations

Resolve Definition-configured calculations against Instance sources/row identity while preserving existing deterministic HyperFormula and provenance guarantees.

### CORE-03.10 — Write-back

Route Dataset, Model and Instance-local edits to exactly one authoritative target. Calculated fields are read-only unless explicitly materialised.

### CORE-03.11 — Views

Keep mutable filters, sorts, grouping, widths/order/visibility/freeze/density as View state over Dataset or Sheet Instance, not Definition semantics.

### CORE-03.12 — Template reference contract

Notebook Templates reference a pinned Sheet Definition version with an explicit policy:

- `create_instance` — default;
- `reference_shared_instance` — deliberate live sharing;
- `pinned_snapshot` — frozen/read-only state.

Full Template UX remains primarily CORE-06 work.

### CORE-03.13 — Reuse/version safety proof

Prove that one Definition can be reused by multiple Template configurations; independent Instances do not share local values; the same Dataset can be reused independently; publishing a new Definition version does not mutate existing Instances; and upgrades are explicit.

### CORE-03.14 — Golden workflow proof

Use a reusable Definition to create a Notebook Sheet Instance combining Sample Records, Upstream Results, Purification Results, local Observation and calculated Recovery. Prove reload, provenance, correct write-back and View state.

## Exit gate

A versioned Sheet Definition creates independent Sheet Instances; an Instance can compose multiple governed sources and local/calculated columns; Template and Dataset reuse are safe and explicit; no Definition/version change silently alters existing scientific work.
