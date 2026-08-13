# Field and schema contract audit

**CORE-01.1 — completed 2026-08-13**

This audit compares the current Model-field, scientific-sheet and Dataset-schema implementations with the proposed common Field Definition kernel. It is implementation-grounded: the sources below are the current branch, not only the Core architecture documents.

## Sources inspected

- `src/db/schema.ts` — current Drizzle representations of `record_field_definitions`, `scientific_columns`, `dataset_schema_fields`, options, relationships and change events.
- `src/lib/model-fields.ts` and `src/lib/model-fields.test.ts` — Model field wire/domain types, values, options and UI conversion behaviour.
- `src/lib/scientific-sheet-data.ts` — scientific column contract, schema editing and formula/dependency identities.
- `src/lib/dataset-schema-data.ts` — Dataset schema field and relationship contracts.
- `drizzle/0013_data_002_scientific_tables.sql` and `0014_data_003_scientific_rest.sql` — scientific sheet field/storage foundation.
- `drizzle/0022_sci_001_scientific_records.sql` and `0023_sci_001_field_definition_grants_and_archive_guard.sql` — scientific Record/field-definition controls.
- `drizzle/0035_sci_010_dataset_schema_registry.sql` — Dataset schema registry and stable field identities.
- `drizzle/0036_sci_011_schema_relationships.sql` — Dataset relationships/cardinality.
- `drizzle/0057_model_fields_foundation.sql` — current extensible Model-field foundation.

## Main conclusion

The repository already contains three field-definition families, but they have substantially converged. `record_field_definitions`, `scientific_columns` and `dataset_schema_fields` use the same logical-type vocabulary:

`text | integer | decimal | boolean | date | timestamp | category | reference`

All three also carry stable UUID identity, stable machine-facing key/name, presentation label, nullability, default, unit and validation metadata. The common kernel should therefore be an extraction/convergence of existing semantics, not a replacement architecture.

## Current concepts and mapping

| Kernel concept | Model fields | Scientific columns | Dataset schema fields | Recommendation |
| --- | --- | --- | --- | --- |
| Durable field identity | `record_field_definitions.id` | `scientific_columns.id` | `dataset_schema_fields.id` | **Preserve.** Canonical `fieldId`; formulas/joins/pipelines should prefer it. |
| Stable machine key | `field_name` | `field_name` | `slug` | **Preserve/adapt.** Canonical `key`; never derive durable identity from label. |
| Display label | `label` | `label` | `label` | **Preserve.** Freely renameable presentation metadata. |
| Logical type | same eight-value vocabulary | same | same | **Preserve exactly initially.** |
| Nullability | `nullable` | `nullable` | `nullable` | **Preserve.** Required is `!nullable`. |
| Default | `default_value` | `default_value` | `default_value` | **Preserve initially.** Current contracts effectively use JSON null as “no explicit default”; make this explicit before supporting null-as-a-default. |
| Validation | JSON object | JSON object | JSON object | **Adapt.** Promote common constraints to typed kernel fields while preserving unknown constraints as extensions during migration. |
| Units | JSON object; UI primarily reads `symbol` | JSON metadata | JSON metadata | **Adapt.** Keep compatibility, then add typed dimension/canonical/allowed-unit semantics. |
| Controlled vocabulary | `model_field_options` with durable option IDs/keys/lifecycle | column options have durable IDs/labels | field registry delegates to scientific compilation | **Preserve Model strength; adapt scientific options** so durable option values/keys are explicit. |
| Record relationship | `reference`; target currently carried in validation metadata/server logic | `reference` | explicit schema relationships exist separately | **Adapt.** Canonical relationship metadata should be explicit, not an opaque validation key. |
| Cardinality | effectively scalar | effectively scalar per cell | relationship registry has 1:1, 1:N, N:N | **Add to kernel.** Existing field contracts map to `one`; future relationships may be `many`. |
| Computed state | stored custom field | stored cells may additionally have per-cell formulas | stored dataset values | **Represent explicitly.** Current fields map to `stored`; do not falsely model per-cell formula state as a computed column. |
| Lifecycle | draft/backfilling/active/retired | active/retired | active/retired | **Use superset** `draft | backfilling | active | retired`; existing scientific/Dataset fields occupy a subset. |

## Model-field behaviour worth preserving

`drizzle/0057_model_fields_foundation.sql` and `src/lib/model-fields.ts` already provide important behaviours that the convergence must not regress:

- UUID field-definition identity survives label/presentation changes.
- Model field keys and types become constrained by lifecycle rather than being casually rewritten after activation.
- Fields can move through draft/backfill/active/retired lifecycle; retirement preserves historical values.
- Category options have durable identities and active/retired lifecycle.
- Server-side defaults and validation remain authoritative; the client intentionally omits blank create values where appropriate.
- Reference fields are validated server-side and reference usage can prevent unsafe deletion.
- Revision/evidence machinery includes field-definition metadata, so schema meaning can be reconstructed historically.

These should be treated as assets, not rewritten merely for naming consistency.

## Important incompatibilities / gaps

### 1. Identity is duplicated in client vocabulary

`ModelFieldLogicalType` and `ScientificLogicalType` separately declare the same eight strings. This is harmless today but invites drift. CORE-01.2 introduces a single `FieldLogicalType` vocabulary.

### 2. Relationship semantics are represented differently

Model references encode target information inside validation metadata, while Dataset schemas have first-class relationship/cardinality objects. The kernel should expose a first-class relationship target and cardinality. CORE-01.3 can adapt existing storage without requiring destructive migration.

### 3. Unit metadata is under-specified

The storage shape is JSON and the Model UI principally consumes `unit.symbol`. A future calculation/pipeline system needs semantic dimensions and allowed/canonical units to avoid treating two visually similar strings as equivalent by accident.

### 4. Category option semantics are stronger in Models

Model options expose `id`, `key`, `label`, order and lifecycle. Scientific column options expose durable IDs and labels but not the same explicit key contract. The kernel should use the stronger durable option identity model and provide compatibility adapters.

### 5. Formula dependencies already demonstrate why field UUID matters

Scientific formulas/dependencies persist `source_column_id` and `target_column_id`. By contrast, some Model UI/table identifiers use `custom:<field_name>`. Human-readable keys are useful API/storage names, but formula/join/pipeline dependencies should bind to durable field IDs whenever the dependency must survive presentation changes.

### 6. `model_base_fields` is not a complete system-field schema

It is primarily a protection/presentation registry for base fields. It should not become a parallel semantic kernel. CORE-01.3/01.4 should decide how system fields project into the canonical contract while retaining their physical storage and protection rules.

### 7. Registry Models are not the Dataset schema implementation

Entries such as `dataset_schema` or `scientific_table` in the Model registry are Records/custom-metadata hosts. The canonical Dataset schema implementation is `dataset_schemas` + `dataset_schema_fields` (+ relationships). Agents must not conflate those concepts.

## Preserve / adapt / deprecate

**Preserve:** existing UUIDs, field keys, logical types, existing Record values, server validation/default behaviour, lifecycle/retirement semantics, option identities, reference integrity, revision evidence and public resources/RPCs during convergence.

**Adapt:** TypeScript contracts to the shared kernel; relationship/cardinality projection; typed units/validation; Dataset/scientific option projection; consumers that need durable dependency identity.

**Deprecate gradually:** duplicated logical-type aliases and ad-hoc interpretation of semantic metadata. Do not delete old API/storage keys until all consumers have migrated and compatibility is proven.

## Decisions carried into CORE-01.2

1. `fieldId` is durable technical identity. Existing UUIDs map directly.
2. `key` is the stable machine/API/storage name (`field_name` or `slug`). It is not the display label.
3. `label` is presentation metadata and may change without changing identity.
4. Initial logical types remain the current eight-value vocabulary; no speculative type expansion in CORE-01.
5. Existing scalar fields map to cardinality `one`; cardinality becomes explicit for future relationships.
6. Reference target semantics become first-class in the canonical contract, with compatibility adapters for current storage.
7. Current fields map to computation mode `stored`; field-level computation is modelled explicitly without confusing it with existing per-cell formulas.
8. No production data migration is required to define the kernel.

## CORE-01.2 implementation evidence

The canonical TypeScript contract is defined in `src/lib/field-definition.ts`, with contract/compatibility tests in `src/lib/field-definition.test.ts`. CORE-01.3 is the first task that should wire production Model-field consumers/storage onto this kernel.
