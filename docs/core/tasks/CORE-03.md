# CORE-03 — Sheet Definition and Compositional Sheet Instance

**Status:** Planned / refine after CORE-02  
**Normative decisions:** ADRs 0020–0024.

## Goal

Implement reusable versioned Sheet Definitions and working Sheet Instances over canonical Datasets/Models.

## Invariants

- Definition and Instance are separate.
- Definitions are reusable organisation-level configuration and do not inherit.
- Instances own local/ad hoc values.
- Dataset reuse is independent of Sheet state.
- Definitions/Template dependencies are version-pinned until explicit upgrade.
- Typed parameters/binding compatibility use stable semantic contracts.
- Row identity, joins and write-back are explicit.
- Calculations have explicit Instance/Definition/Dataset-derived scope.
- Presentation state is persisted without requiring a named View subsystem.
- Composition is virtual until explicitly materialised.
- Shared live Instances are explicit.

## Planned tasks

### CORE-03.1 — Audit current Sheet/Template persistence

Map existing Sheet blocks/tables, Handsontable state, calculations, Template references and persistence into Definition versus Instance responsibilities.

### CORE-03.2 — Sheet Definition persistence/versioning

Implement versioned organisation-level Definitions with parameters, binding contracts, row identity, joins, columns, calculations, write-back rules, actions and presentation defaults.

### CORE-03.3 — Sheet Instance persistence

Implement working Instances with optional source Definition/version, resolved bindings, local fields/values, calculations/overrides, presentation state, lifecycle and provenance.

### CORE-03.4 — Shared typed parameters and binding compatibility

Use the common Parameter concept and support exact, compatible-lineage and semantic/structural Dataset requirements. Do not match by labels alone.

### CORE-03.5 — Row identity

Implement source/composite/local identity. Visual row position is never durable identity.

### CORE-03.6 — Constrained joins

Implement explicit equality joins/cardinality expectations. Surface unexpected many-to-many expansion.

### CORE-03.7 — Bound columns and provenance

Resolve Dataset/Model/relationship fields while retaining source identity and write target.

### CORE-03.8 — Durable local/ad hoc fields

Persist typed Instance-owned local fields/values. They survive reload/share/audit and are included in frozen Instance evidence.

### CORE-03.9 — Calculation scopes

Preserve HyperFormula trust/provenance. Support Instance-local and Definition calculations. Prepare explicit promotion into Dataset-derived fields without making Handsontable authoritative for Dataset semantics.

### CORE-03.10 — Write-back

Route each writable Dataset/Model/local value to one authoritative target.

### CORE-03.11 — Presentation state

Persist filters, sorts, grouping and column presentation on the Instance as appropriate. Do not build named Views as a prerequisite.

### CORE-03.12 — Save Instance as Definition

Extract reusable structure from an ad hoc Instance, parameterise concrete sources, retain selected reusable calculations/local-column definitions, exclude working values and optionally adopt presentation defaults.

### CORE-03.13 — Explicit Definition upgrade

Implement/prepare data-preserving three-way upgrade semantics. Never silently destroy Instance-owned data.

### CORE-03.14 — Materialisation

Explicitly create a new Dataset from a composed Sheet result with source/calculation provenance. Keep semantics compatible with future Pipeline Runs.

### CORE-03.15 — Reuse/version/lifecycle proof

Prove independent Instances from one Definition, Dataset reuse without Sheet-state sharing, explicit shared Instance behaviour, no silent Definition upgrade, archive/retire dependency handling and Sheet duplication without implicit Dataset duplication.

### CORE-03.16 — Golden workflow

Use `Purification Summary` Definition to create a Notebook Sheet Instance combining Sample Records, Upstream Results, Purification Results, local Observation and calculated Recovery. Prove reload, correct write-back, presentation state, provenance and optional materialisation.

## Exit gate

A reusable Definition creates independent compositional Instances; multi-source identity/joins/write-back/local/calculated state are correct; Definition reuse/upgrades/lifecycle are safe; composition remains virtual unless explicitly materialised.
