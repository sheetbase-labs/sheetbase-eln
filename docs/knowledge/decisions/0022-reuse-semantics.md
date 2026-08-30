# ADR 0022 — Definition, Template and Binding Reuse

- Status: Accepted
- Date: 2026-08-13
- Related: ADR 0020 and ADR 0021

## Decisions

### No Sheet Definition inheritance

Sheet Definitions do not extend other Sheet Definitions. Reuse the whole versioned Definition initially. If repeated substructures later justify reuse, introduce explicit composable fragments rather than parent-child inheritance.

### No Notebook Template inheritance

Notebook Templates do not extend other Notebook Templates. The architecture reserves versioned reusable Template Sections/blocks as a future composition mechanism for common material. These sections are not required in the first implementation.

### Save Sheet Instance as reusable Definition

A useful working Sheet Instance can be saved as a Sheet Definition. The operation extracts reusable structure rather than copying experiment data.

```text
Working Sheet Instance
        |
        | Save as Definition
        v
extract structure
parameterise sources
exclude working values
        |
        v
Sheet Definition
```

Concrete Dataset bindings can become input parameters. Local column definitions may be retained as empty local columns. Local values are not copied. Reusable calculations can be retained. Current presentation state may optionally become a default View.

### Definition upgrades are explicit

Existing Sheet Instances do not silently change when a new Definition version is published.

An explicit upgrade compares the source Definition version, Instance-specific changes, and target Definition version.

```text
        Definition v1
         /          \
Instance changes   Definition v2
         \          /
          explicit upgrade
```

Upgrades must never silently destroy Instance-owned data. Conflicts require explicit resolution, such as retaining a removed column locally, mapping it to a replacement, or deferring the upgrade.

### Bindings use typed input contracts

Reusable Sheet Definitions can declare Dataset input requirements rather than hard-coding one Dataset.

Three compatibility strengths are supported conceptually:

1. **Exact** — specific Dataset Schema/version.
2. **Compatible lineage** — compatible version/descendant of a known Dataset Schema.
3. **Semantic/structural contract** — required semantic fields/types/relationships without requiring one schema lineage.

Compatibility uses stable semantic identities/contracts, not human column labels alone.

A controlled workflow may require exact compatibility; exploratory definitions can accept broader compatible contracts. The same compatibility concept should later support Pipeline inputs.

## Consequences

- Definitions and Templates avoid brittle inheritance chains.
- Reusable work can emerge from ad hoc work.
- Working data is not accidentally copied into definitions.
- Existing Instances remain stable as Definitions evolve.
- Upgrades preserve local scientific data.
- One Definition can work with multiple appropriate Datasets.

## Rejected alternatives

- Sheet Definition inheritance.
- Notebook Template inheritance.
- Copying Instance data into a Definition.
- Automatic Instance upgrades.
- Requiring exact Dataset Schema versions for every binding.
- Determining compatibility from column labels alone.

## Constraints

1. Reusable substructure uses explicit composition if introduced.
2. Saving an Instance as a Definition does not copy Instance working values.
3. Definition upgrades are explicit and data-preserving.
4. Binding compatibility never relies solely on labels or visual positions.
5. Version pinning follows ADR 0020.
