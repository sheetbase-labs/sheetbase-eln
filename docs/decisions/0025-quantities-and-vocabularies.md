# ADR 0025 — Scientific Quantities and Controlled Vocabularies

- Status: Accepted
- Date: 2026-08-13
- Related: ADR 0021; common Field Definition kernel

## Quantities

Numeric fields may have explicit scientific quantity semantics.

A quantity definition separates scientific meaning, dimensional compatibility and representation:

```text
Quantity
  kind
  dimension
  storage_unit
  allowed_input_units?
  preferred_display_unit?
```

Examples include mass, concentration, vector titre, viability and MOI.

### Canonical storage

A governed numeric field uses one canonical storage unit. Users may enter compatible units; Sheetbase converts to the storage unit before persistence.

```text
0.01 g -> 10 mg -> stored as 10
```

Mixed-unit physical storage within one governed column is avoided by default.

Display units are presentation and may differ from storage units.

### Scientific meaning and dimensions

Compatibility is not based only on numeric type or mathematical dimension.

`quantity_kind` preserves scientific meaning, including cases that are mathematically dimensionless but scientifically distinct, such as viability, recovery and MOI.

Dimensions/units support conversion compatibility. For example `mg/mL` and `g/L` may be convertible while `mg/mL` and `cells/mL` are not.

### Unit definitions

Common SI/scientific units are protected system definitions. Organisations may define appropriate scientific/custom units such as TU, vg or assay-specific units through authorised configuration.

Do not build a bespoke general unit-conversion engine when a mature standards-aligned implementation can be used.

### Calculations

CORE-01 does not require complete dimensional formula inference. Initially fields know quantity semantics, compatible input conversion/validation is supported, and calculated outputs can declare explicit quantity semantics. The architecture must permit future unit-aware formula inference.

## Controlled vocabularies

Sheetbase supports two category sources:

1. **embedded field options** for simple field-local categories;
2. **reusable governed vocabularies** for concepts shared across Models/Dataset Schemas.

Governed vocabulary terms have stable IDs/keys separate from display labels, so label changes do not break historical data or dependencies.

```text
Vocabulary: QC Outcome
  term id A / key PASS / label Pass
  term id B / key FAIL / label Failed
  term id C / key INVALID / label Invalid
```

The common Field Definition contract must be able to reference either embedded options or a governed vocabulary. Full vocabulary-management UX is not required for initial CORE-01 implementation.

## Constraints

1. Storage unit and display unit are separate concepts.
2. Governed columns normally use one canonical storage unit.
3. Compatibility considers scientific quantity kind plus dimensional/unit compatibility.
4. Dimensionless scientific quantities are not automatically interchangeable.
5. Organisation-defined units do not redefine protected system-unit meaning.
6. Category values/dependencies use stable option/term identities, not labels alone.
7. Embedded categories remain supported; governed vocabularies are an additional reusable mechanism.
