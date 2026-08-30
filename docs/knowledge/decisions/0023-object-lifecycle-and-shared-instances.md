# ADR 0023 — Object Ownership, Lifecycle and Shared Sheet Instances

- Status: Accepted
- Date: 2026-08-13
- Related: ADR 0020, ADR 0021, ADR 0022

## Context

Reusable Datasets, Definitions, Templates and Sheet Instances create dependency graphs that must survive users leaving, objects being archived, and scientific evidence being frozen. Shared live Sheet Instances also need predictable ownership and local-data behaviour.

## Decisions

### Workspace ownership

Durable scientific objects are owned by the Workspace, not by individual users. Users are recorded as creators/editors and permissions govern their actions, but a user's departure must not orphan scientific objects.

Projects/folders organise and contextualise objects; they are not the fundamental lifecycle ownership boundary.

### Archive is the normal removal mechanism

Durable objects normally move from active to archived state rather than being destroyed. Archived objects preserve identity and existing references and can be restored where policy permits.

New bindings/references to archived objects are normally prevented, while existing permitted consumers can continue to resolve them.

### Retire applies to definitions

Definitions and schemas may be retired. Retirement prevents new use/instantiation while preserving existing Instances, historical references and immutable evidence.

```text
Definition [retired]
  +-- existing Instance: valid
  +-- historical evidence: valid
  `-- new Instance: blocked
```

### Hard deletion is exceptional and dependency-aware

Hard deletion is allowed only when policy permits and no protected dependencies require the object.

Anything referenced by immutable scientific evidence cannot be hard-deleted through normal product operations.

Attempting destructive lifecycle changes should surface dependency impact before commit.

### Shared live Sheet Instances are explicit

A Sheet Instance may deliberately be embedded/referenced from multiple locations.

```text
Notebook A --+
             +-- Shared Sheet Instance
Notebook B --+
Project -----+
```

The UI must make shared state obvious because editing the Instance from any location changes the same underlying Instance.

Normal Notebook-created Sheets should not accidentally become shared merely because the same Sheet Definition or Dataset is reused.

### Submitted Notebooks freeze shared Sheet state

A submitted/reviewed Notebook does not rely on a continuing live shared Sheet Instance as its scientific evidence.

At the evidence boundary, the relevant Sheet Instance state is snapshotted/pinned according to ADR 0021. The live shared Instance may continue evolving independently.

### Local data belongs to the Sheet Instance

Sheet-local field definitions and values belong to the Sheet Instance, not to the Notebook block, Sheet Definition or bound Dataset.

Therefore, multiple embeddings of the same live Sheet Instance see the same local values. Independent local values require independent Sheet Instances.

### Duplicate Sheet Instance does not duplicate bound data

Duplicating a Sheet Instance creates a new independent Instance and copies appropriate Instance-owned configuration/state, including local field definitions/values and Instance overrides according to the duplication operation.

Bound Datasets and Records remain references to the same underlying objects unless the user explicitly performs a separate Dataset/Record duplication operation.

```text
             Dataset X
              ^     ^
              |     |
Instance A         Instance B
```

Duplicating underlying Dataset data is a separate explicit action, never an accidental side effect of duplicating a Sheet.

### Complex duplication must expose dependency policy

When duplicating higher-level objects such as Notebooks, owned working objects and shared references must follow explicit copy/reference policies. Shared references remain shared unless the operation explicitly requests otherwise. Complex cases should expose a dependency preview rather than silently guessing.

## Lifecycle vocabulary

```text
Archive
  remove from normal active use
  preserve identity and references

Retire
  definition/schema unavailable for new use
  preserve existing dependants and history

Hard delete
  destructive removal
  exceptional and blocked by protected dependencies
```

## Consequences

- User departure does not orphan scientific data.
- Existing scientific references survive normal cleanup/archive operations.
- Shared editing is deliberate and understandable.
- Submitted evidence remains stable even when shared working Sheets continue changing.
- Sheet-local data has one clear owner.
- Duplication does not unexpectedly copy potentially large or authoritative Datasets.

Costs include dependency tracking, archive/retirement-aware selectors, shared-state indicators, snapshot semantics and explicit duplication policy for complex object graphs.

## Rejected alternatives

- User-owned durable scientific objects: creates orphaning/lifecycle problems.
- Hard-delete as normal cleanup: breaks references and evidence.
- Allow new consumers of archived/retired objects by default: undermines lifecycle meaning.
- Silent shared Sheet references: users may unknowingly modify data visible elsewhere.
- Submitted Notebooks retaining live evidence references: undermines reproducibility.
- Local data owned by each embedding block: makes the same Sheet Instance behave differently depending on where it is viewed.
- Duplicate Sheet automatically duplicates Datasets: conflates presentation/working state with authoritative data ownership.

## Constraints

1. Durable scientific objects have Workspace lifecycle ownership.
2. Existing references to archived objects remain resolvable where permissions permit.
3. Retired definitions cannot normally create new Instances.
4. Protected immutable evidence blocks hard deletion.
5. Shared live Sheet Instances are explicitly indicated.
6. Submitted evidence snapshots/pins shared Instance state.
7. Sheet-local data is owned by the Sheet Instance.
8. Sheet duplication does not implicitly duplicate bound Datasets or Records.
