# Schema capability and configuration-authority audit

**CORE-05.1 — completed 2026-08-15**

This audit maps current workspace roles, RLS, schema-management RPCs, UI
gating, dependency information and lifecycle behaviour. It is
implementation-grounded on `gwp/core-05-schema-evolution-9361` at
`27c0b0aba1c713cc99e1d17e2098795d8591cf1e` (PR 29 / `agent/core-programme`
after CORE-04). No product behaviour changed in this task.

Capability storage, role remapping, dual Dataset Schema convergence, and
Sheet Instance upgrade tightening are **not decided here**. Recommendations
are labelled as such.

## Sources inspected

- `drizzle/0004_workspace_rls.sql`, `0054_admin_001_workspace_admin.sql`
- `drizzle/0061_core_016_schema_capabilities.sql`, `0063_productive_the_captain.sql`
- `drizzle/0023_sci_001_field_definition_grants_and_archive_guard.sql`,
  `0057_model_fields_foundation.sql`
- `drizzle/0035_sci_010_dataset_schema_registry.sql`,
  `0036_sci_011_schema_relationships.sql`
- `drizzle/0062_shallow_energizer.sql` (CORE-02 schema identity)
- `drizzle/0072_core_032_sheet_definitions.sql`, `0086`, `0088`, `0090`
- `drizzle/0074`–`0085`, `0081`, `0083` (Instance, local fields, calculations)
- `drizzle/0092_core_046_validate_sheet_record_batch.sql`,
  `0093_core_047_commit_sheet_record_batch.sql`
- `drizzle/0029_sci_006_templates.sql`, `0010_eln_notebook_rpcs.sql`,
  `0017_calc_002_formula_persistence.sql`
- `src/db/schema.ts`, `src/lib/postgrest-token.ts`, `src/lib/current-user.ts`,
  `src/lib/external-token.ts`, `src/routes/api/db/$.ts`
- UI: `src/routes/admin.tsx`, `src/components/workspace-admin/admin-model-fields.tsx`,
  `src/routes/schemas.tsx`, `src/lib/templates.ts`, `src/lib/sheet-record-actions.ts`,
  `src/lib/sheet-instance-data.ts`, `src/lib/dataset-schema-data.ts`,
  `src/lib/dataset-explorer-data.ts`
- Tests: `tests/db/model-fields.test.ts`, `dataset-schema-registry.test.ts`,
  `workspace-admin.test.ts`, `sheet-definitions.test.ts`,
  `sheet-reuse-lifecycle.test.ts`, `sheet-record-actions.test.ts`
- ADRs 0002, 0005, 0006, 0021, 0023, 0024, 0034, 0035

## 1. Authority model as implemented

### 1.1 Claims versus membership

The PostgREST JWT (`src/lib/postgrest-token.ts`, ADR 0005) carries only:

`sub`, `workspace_id`, `session_id`, optional `client_id`, `role: authenticated`.

It does **not** carry workspace membership role. UI permission state comes
from `getCurrentContext()` reading `api.workspace_memberships.role`. Server
enforcement reads the same table through `SECURITY DEFINER` helpers with
`search_path=''`.

Implication: a capability model can stay membership-table-derived without
changing the JWT, as long as helpers remain the authority. Putting
capabilities in JWT claims would be a new auth architecture (ADR trigger).

### 1.2 Membership roles

`api.workspace_memberships.role` CHECK
(`drizzle/0054`, `src/db/schema.ts`):

`owner | admin | member | scientist | analyst | reviewer | viewer`

`api.is_workspace_member(workspace, role default null)` matches any
unsuspended membership when `p_role` is null, or **exact** role equality
when `p_role` is supplied. There is no role hierarchy (`admin` does not
satisfy `p_role='owner'`).

**Used meaningfully today**

| Role | Where it changes server behaviour |
| --- | --- |
| `owner` | Workspace admin RPCs; SCI-010 publish/retire/relationship delete; `has_schema_capability` Dataset publish/retire and relationship retire |
| `admin` | Model field manage (`has_schema_capability` / `is_model_field_admin`); Sheet Definition admin (`is_sheet_definition_admin`); Template UI manage |
| `member` | Default invitation role; same data-plane rights as every unsuspended membership |

**Invitable / seedable but ignored by schema helpers**

`scientist`, `analyst`, `reviewer`, `viewer` may be stored (invitations,
`change_member_role`, month-scale seed). They still satisfy
`is_workspace_member(workspace)` with no role argument.

Consequences:

- Workspace `viewer` is **not** read-only. A `viewer` member can create
  Records, mutate Instance-local fields, apply Definition upgrades, and
  create SCI-010 draft schemas.
- Membership `reviewer` is unrelated to review-workflow
  `assigned_reviewer_user_ids` / study-task `reviewer`.
- `project_access.access_level` (`owner|editor|viewer`) is a separate enum
  and does **not** gate schema RPCs.

CORE-05 should leave the CHECK constraint in place. Do not map
`scientist`/`analyst`/`reviewer`/`viewer` onto schema authority until an
explicit product decision. Do not silently make `viewer` read-only in
Bundle 2 without calling that a behaviour change.

### 1.3 Parallel helpers (the core fragmentation)

| Helper | Mapping | Consumers |
| --- | --- | --- |
| `api.has_schema_capability(workspace, text)` | `model_field.manage` → owner/admin; `dataset_schema.publish` / `dataset_schema.retire` / `schema_relationship.retire` → **owner only**; unknown → false | CORE-02 Dataset Schema table RLS; `is_model_field_admin` |
| `api.is_model_field_admin` | Delegates to `has_schema_capability(..., 'model_field.manage')` | Model field RPCs |
| `api.is_sheet_definition_admin` | Hard-coded owner/admin; **does not** call `has_schema_capability` | Sheet Definition create/publish/retire; extract-as-Definition |
| `api.is_workspace_member(ws)` | Any unsuspended membership | Almost all data-plane RPCs and read RLS |
| `api.is_workspace_member(ws, 'owner')` | Exact owner | SCI-010 publish/retire/delete relationship; workspace settings |

`has_schema_capability('schema_relationship.retire')` is **defined but unused**.
SCI-010 `delete_schema_relationship` uses `is_workspace_member(..., 'owner')`
instead.

### 1.4 Grants and RLS pattern

Request roles get nothing by default (ADR 0002). Typical configuration
objects:

- **Read:** `SELECT` + membership RLS.
- **Mutate:** `SECURITY DEFINER` RPC, `search_path=''`, `REVOKE EXECUTE FROM PUBLIC`, `GRANT EXECUTE TO authenticated`, internal role check raising `42501`.
- **Exception — CORE-02 Dataset Schema identity:** `GRANT SELECT, INSERT, UPDATE` on
  `dataset_schema_definitions` / versions / version fields; write RLS is
  `has_schema_capability(..., 'dataset_schema.publish')`. There is **no**
  publish RPC; tests and seed paths `INSERT`/`UPDATE` rows directly.
- **Exception — Model fields:** `0057` revoked table DML; RPCs only.
- **Exception — Sheet Definitions:** member `SELECT`; writes RPC-only;
  versions immutable once published.

Direct PostgREST writes that bypass RPCs remain a regression surface for
CORE-02 schema tables and SCI-010 insert policies (members may insert
draft `dataset_schemas` rows).

## 2. Authority matrix

Legend for **Desired CORE-05 owner**: recommendation only; Bundle 2 must
confirm. `TBD` means the audit should not pretend the spec already chose.

| Operation | Authoritative server check | Helper | RLS / grants | Current UI gating | UI ↔ server | Likely disposition |
| --- | --- | --- | --- | --- | --- | --- |
| Add/edit/activate/retire Model field and options | RPC `create_model_field`, `update_model_field`, `activate_model_field`, `retire_model_field`, option RPCs; `42501` `owner/admin required` | `is_model_field_admin` → `has_schema_capability('model_field.manage')` | Table DML revoked; SELECT + membership | `/admin/model-fields`: `canManage` = owner or admin | Agree | **KEEP** helper; **ADAPT** mapping so a steward can manage without workspace admin |
| Configure Model field semantics | `configure_model_field_semantics` (same admin helper) | same | same | Admin Model Fields dialog | Agree | **KEEP** |
| Model field usage count | `model_field_usage`; member | `is_workspace_member` | SECURITY DEFINER | Admin usage column | Agree | **ADAPT** into real dependency graph (05.4); count is insufficient |
| Create SCI-010 Dataset Schema draft | `create_dataset_schema`; any member via `assert_scientific_actor` | membership | Members insert drafts; owners update/publish | `/schemas`: create available to members; draft edit = owner **or creator** | Agree with ADR 0034 | **ADAPT** after canonical schema decision; do not treat as CORE-02 publish |
| Edit SCI-010 draft fields | `add_dataset_schema_field`; creator or owner | `created_by` or `is_workspace_member(...,'owner')` | Draft-only | `canAddToSelected` matches | Agree | **ADAPT** / likely **DEPRECATE** as governed path |
| Publish SCI-010 Dataset Schema | `publish_dataset_schema`; owner | `is_workspace_member(...,'owner')` **not** `has_schema_capability` | Owner update policy | `isOwner` | Agree; **too coarse vs CORE-05 steward** | **CONVERGE** onto capability helper if this stack remains |
| Retire SCI-010 field | `retire_dataset_schema_field`; owner | owner exact | Owner | Owner | Agree | same |
| Create SCI-010 relationship | `create_schema_relationship`; any member | `assert_scientific_actor` | Member INSERT policy | Schema graph UI | Agree; **broader than schema-edit authority** | **ADAPT** |
| Soft-delete SCI-010 relationship | `delete_schema_relationship`; owner | owner exact; unused `schema_relationship.retire` capability | Owner UPDATE/DELETE | Owner | Agree | **CONVERGE** helper |
| Insert/update CORE-02 Dataset Schema definition/version/fields | Direct table write | `has_schema_capability('dataset_schema.publish')` — **owner only** | Write RLS; no DELETE grant | **No product UI** | N/A (API/tests/materialisation only) | **KEEP** as canonical store; **ADAPT** to controlled publish RPC; **widen mapping** for steward |
| Retire CORE-02 Dataset Schema | Same write RLS (`dataset_schema.retire` exists on helper but policies use **publish**) | publish capability | Write RLS | None | N/A | **ADAPT** distinct publish vs retire |
| Create/update Dataset rows/values | Controlled Dataset RPCs; any member | `is_workspace_member` | Member ALL on `datasets` metadata; value RPCs | Dataset Explorer is read (`query_dataset_rows`) | Data edit ≠ schema edit (good) | **KEEP** split |
| Create Sheet Definition / version / publish / retire | Definition RPCs; `42501` owner/admin | `is_sheet_definition_admin` | Member SELECT; RPC execute | Data client only; no canonical Definition UI | No UI to disagree | **CONVERGE** onto `has_schema_capability`; **ADAPT** steward mapping |
| Extract Instance → Definition draft | `extract_sheet_definition_draft`; owner/admin. Preview is any member | admin vs member | RPC | Data client | Preview broader than commit (good) | **KEEP** split; map commit to Definition-create capability |
| Instantiate from published Definition | `create_sheet_instance_from_definition`; any member; retired Definitions blocked (`0090`) | membership | RPC | Data client / tests | N/A | **KEEP** as data-plane instantiate |
| Preview/apply Sheet Instance Definition upgrade | `preview_sheet_instance_definition_upgrade` / `apply_...`; any member; revision CAS; conflict decisions | membership | RPC + upgrade provenance table | Data client | N/A | **KEEP** preview for members; **ADAPT** apply capability in 05.2 **without tightening in 05.1**. Apply **can** change semantic interpretation (map/retain-local/defer) but pinned Definition versions stay immutable and provenance is recorded |
| Archive/duplicate Sheet Instance | `archive_sheet_instance` / `duplicate_sheet_instance`; member | membership | RPC; Instances cannot be hard-deleted | Data client | N/A | **KEEP**; share/embed is CORE-06 (no share RPC today) |
| Mutate Instance-local fields/values | `mutate_sheet_instance_local_state`; member; optimistic revision + retry token | membership | RPC | Composed-Sheet is write-back/Records, not a local-field editor UI | Server allows members to add local fields | **KEEP** as Scientist local work; promotion is 05.7 |
| Mutate Instance calculations | `mutate_sheet_instance_calculations`; member; retry token | membership | RPC | None dedicated | Same | **KEEP** local; promotion is 05.8 |
| Materialise composed Sheet | `materialize_sheet_instance`; member | membership | Creates CORE-02 schema+Dataset Version | Data client | N/A | **KEEP** as explicit data operation; schema it creates should remain steward-governed afterwards |
| Search/link Sheet Records | `search_sheet_records`; member | membership | RPC | Definition `actions` hide/disable in UI only | **Disagree by design** (CORE-04.9) | **ADAPT** in 05.2/05.3: server link vs create |
| Create+link / bulk commit Records | `create_and_link_sheet_record`, `commit_sheet_record_batch`; member; `create_model_record` path | membership | RPC; write-back failure rolls back | Same UI hide | Server allows any member | **ADAPT** create-capable vs link-only; do not change CORE-04 yet |
| `create_model_record` / `update_record_custom_fields` | Any member; Record RLS | membership | INVOKER + row RLS | Registry + Sheet | Agree that data-edit ≠ schema-edit | **KEEP** off schema capability; still not on external allowlist (`NEXT.md`) |
| Create/instantiate Notebook Template | `create_model_record` / `instantiate_template`; member | membership | RPC | Library: instantiate if validated | Agree | **KEEP** instantiate as data-plane |
| Archive Template | `archive_record`; any member who can see the row | membership + metadata CAS | RPC | UI: author or owner/admin (`canManageTemplate`) | **UI stricter than server** | **ADAPT** Template lifecycle capability; RLS remains authority |
| Workspace invite / role change / settings | Owner RPCs (`SB055`) | owner | RPC + events | `/admin` owner sections | Agree | **KEEP** as workspace administration, distinct from schema stewardship |
| Hard-delete protected objects | No product hard-delete RPC for Models/Definitions/CORE-02 schemas; Sheet Instance DELETE blocked | — | FK cascades on workspace delete only | None | N/A | **KEEP** exceptional; 05.10 must block evidence-protected delete |

## 3. KEEP / ADAPT / CONVERGE / DEPRECATE

### KEEP

- PostgreSQL/RLS as the security boundary; UI never sole enforcement.
- Distinct data-edit vs schema-edit intent (Model RPCs vs Record RPCs;
  Dataset row RPCs vs schema writes).
- Fail-closed unknown capabilities in `has_schema_capability`.
- `SECURITY DEFINER` + empty `search_path` + explicit GRANT/REVOKE.
- JWT **without** membership role (helpers remain source of truth).
- Sheet Definition / Instance split; immutable published Definition versions.
- Instance-local field/calculation mutation as member Scientist work.
- CORE-03.13 upgrade preview + explicit decisions + provenance rows.
- CORE-03.15 retire-Definition-blocks-new-instantiate while existing
  Instances resolve.
- Model field stable UUID + key; active contract immutability
  (`SB072` on nullable/default/validation once active).
- `model_field_manifest` for historical Record interpretation.
- Named Views remaining out of Core.

### ADAPT

- Single capability vocabulary consumed by every configuration RPC.
- Map schema authority so a Data Steward can publish/evolve without
  `owner` workspace administration (05.2 exit gate).
- Replace “UI hide only” CORE-04.9 Record actions with server
  link-only vs create-capable checks.
- CORE-02 schema mutation: replace owner-only direct table writes with
  controlled publish/retire RPCs (parity with Model/Definition).
- Distinguish `dataset_schema.publish` vs `dataset_schema.retire` in
  actual policies (today write RLS uses publish for all writes).
- Template archive: either document UI-only manage or enforce server-side.
- `model_field_usage` → structured dependency records (05.4).
- Workspace `viewer`/`scientist`/`analyst`/`reviewer`: document and
  decide; do not keep pretending `viewer` is read-only.

### CONVERGE

- `is_sheet_definition_admin` → `has_schema_capability`.
- SCI-010 owner checks → same helper **if** that stack remains writable.
- Unused `schema_relationship.retire` token → actual relationship RPC.
- `/admin/model-fields` and `/schemas` into one steward configuration
  surface (05.9), after the canonical Dataset Schema is chosen.
- External `scientific:schema` scope with whatever becomes canonical
  (today it allowlists SCI-010 RPCs only, not CORE-02 tables/RPCs).

### DEPRECATE (do not delete in CORE-05; stop extending)

- SCI-010 as the **governed** Dataset Schema product path, if CORE-02 is
  confirmed canonical (see §5). Freeze new CORE-05.6 versioning on
  `api.dataset_schemas` revision rows.
- Direct authenticated INSERT/UPDATE on CORE-02 schema tables as the
  supported management API.
- Parallel owner/admin string checks copied into new RPCs.
- Treating `formula_dependencies` (scientific table/row/column) as
  FieldDefinition impact analysis.
- Inferring dependencies from labels, slugs, or A1 coordinates.

## 4. Capability-storage options (no implementation)

### What exists

No `capability_grants` table. Authority is role-derived inside helpers.
UI duplicates a subset of those mappings in React (`isOwner`,
`canManageModelFields`, `canManageTemplate`).

### Option A — Membership-role mapping only

Extend `has_schema_capability` CASE arms. Add or reuse a membership role
such as `steward` (new CHECK value) or a documented alias.

- Pros: no JWT change; one helper; matches ADR 0006 “extend the helper”.
- Cons: coarse (all schema capabilities or none); unused roles already
  clutter the CHECK; `steward` vs `admin` must be product-defined.

**ADR:** not required if this remains “map roles → existing helper”.

### Option B — Persisted capability grants

New workspace-scoped grant rows (user × capability, maybe object class).

- Pros: schema authority without a new coarse role; per-capability
  (publish vs retire vs promotion).
- Cons: new auth table, RLS, audit, UI, grant/revoke; JWT still should
  **not** embed grants (helpers must read tables).

**ADR: required.** CORE architecture §28 already lists
“capability/policy storage” as a deferred implementation ADR.

### Option C — Small combination

Keep roles for defaults (`owner` implies all; `admin` implies Model+Definition
but not Dataset publish today; `member` implies data-plane). Add an optional
grant overlay only for `schema.*` capabilities.

**ADR: required** if grants are durable and queryable as a new control plane.

### What a Data Steward needs without workspace administration

Today Dataset Schema **publish** is owner-only, so an `admin` cannot publish
CORE-02 or SCI-010 schemas. Model fields and Sheet Definitions allow `admin`.
A steward who is neither owner nor admin cannot do any of those.

Minimum 05.2 shape:

1. One helper (`has_schema_capability`) for all configuration RPCs.
2. A way to grant `schema.edit` / `schema.publish` without `create_invitation`
   / `change_member_role` / workspace settings.
3. Data-plane RPCs remain membership, not schema capability.
4. UI reads the same helper (RPC) rather than duplicating role strings.

### Recommendation (not implemented)

Prefer **Option A for Bundle 2**: introduce or map a single steward-class
membership role into `has_schema_capability`, and converge helpers.
Do **not** persist grants yet. Do **not** put capabilities in JWT claims.

Revisit Option B/C only if product requires mixed capabilities per person
(link-only Record create vs schema publish vs Template publish) that a
single role cannot express. CORE-04.9’s link-vs-create split is the likely
trigger for a **small** extra capability (`records.create`) still role-mapped
(`member`+ vs `viewer`) rather than a grant table.

**Bundle 2 must not proceed** until the role-vs-grants choice is confirmed.

## 5. Dual Dataset Schema systems

Two durable stacks exist. They do not share identity tables.

### SCI-010 / ADR 0034 — `api.dataset_schemas`

| Topic | Fact |
| --- | --- |
| Identity | Workspace + `slug`; each **revision is a separate row** (`id`) |
| Fields | `api.dataset_schema_fields.id`; stable **within (schema_id, slug)**; new revision gets new field UUIDs; publish remaps relationships **by slug** |
| Status | `draft \| published \| retired` on the revision row |
| Consumers | `/schemas` UI; `query_dataset`; `scientific_tables.dataset_schema_id`; formula-era sheets; external `scientific:schema` RPCs |
| RPCs | `create_dataset_schema`, `add_dataset_schema_field`, `retire_dataset_schema_field`, `publish_dataset_schema`, `instantiate_dataset_schema`, `upgrade_scientific_schema`, `bind_legacy_sheet`, relationship RPCs |
| RLS | Members read/create drafts; owner publish/retire |
| Events | `dataset_schema`, `dataset_schema_field`, `dataset_schema_relationship` |
| Datasets | Instantiation creates **scientific_tables** (physical sheet tables), not CORE-02 `api.datasets` |

### CORE-02 / ADR 0021+0037 — `api.dataset_schema_definitions`

| Topic | Fact |
| --- | --- |
| Identity | Workspace + `key`; stable schema UUID |
| Versions | `api.dataset_schema_versions` monotonic `version`; field rows keyed by **stable `field_id`** across versions |
| Lifecycle | definition `draft\|active\|retired`; version `draft\|active\|retired` |
| Consumers | `api.datasets.schema_version_id` (RESTRICT FK); Sheet parameter compatibility; composition; materialisation (`0089` inserts CORE-02 schema+version); Dataset Explorer `query_dataset_rows` |
| RPCs | **None** for schema publish; table DML + capability RLS |
| UI | None |
| Events | **Not** in `chk_change_events_entity_type` |
| Tests/seed | DB tests insert as owner; demo seed does not obviously populate this for the golden UI |

### Overlap and contradictions

- Both claim to be “the Dataset Schema”.
- Versioning: SCI-010 copies a new row per revision and retires the previous
  published slug; CORE-02 keeps one definition and immutable versions.
- Field identity: SCI-010 field UUIDs are revision-scoped (slug is the join
  key); CORE-02 `field_id` is the semantic identity Sheet Definitions bind
  (`sourceFieldId`).
- `/datasets` Explorer reads CORE-02 live rows; `/schemas` edits SCI-010.
- Sheet Definition Dataset parameters resolve CORE-02 schema versions
  (`0075`). They do not bind SCI-010 slugs.
- `has_schema_capability('dataset_schema.publish')` gates CORE-02 table
  writes only. SCI-010 publish ignores that helper.
- Relationship graph exists only on SCI-010.

### Recommendation (not implemented)

**Canonical for CORE-05.6 / promotion / steward UX:** CORE-02
`dataset_schema_definitions` + versions + stable `field_id`.

**SCI-010:** compatibility surface for scientific tables and the current
`/schemas` editor. Freeze new governed evolution there. Do not implement
compatible/migration-requiring/breaking classification twice.

Realistic options for later (not Bundle 1):

1. **Freeze + dual-read (recommended for CORE-05):** steward tools and 05.6
   operate on CORE-02; SCI-010 remains until CORE-06/legacy sheets migrate.
2. **One-way projection:** publish CORE-02 versions into SCI-010 slug
   revisions for `query_dataset` — high risk, slug remapping already
   destroys field UUIDs.
3. **Big-bang migrate scientific_tables → api.datasets:** out of CORE-05
   scope; needs its own ADR.

Do not attempt (2) or (3) inside 05.6.

## 6. Workspace versus organisation

ADR 0024 places Models, Dataset Schemas, Sheet Definitions and Templates at
organisation/tenant scope. Implementation is **workspace-owned**
(`workspace_id` on every table; RLS via `current_workspace_id()`).

No CORE-05.1 finding requires organisation RLS. Stay workspace-scoped.
Organisation migration remains the deferred ADR listed in CORE architecture
§28.

## 7. Sheet Instance upgrade authority

Server: any unsuspended workspace member may preview and apply
`apply_sheet_instance_definition_upgrade` (`0088`). Apply is
revision-CAS, requires one decision per conflict, records
`api.sheet_instance_definition_upgrades`, and keeps Definition versions
immutable.

Semantic effect: mapping/deferring columns and parameters **does** change
how the Instance interprets sources and local data. Historical local values
can be retained unmapped. It does not rewrite published Definitions or
Dataset Versions.

UI: data client only; no dedicated button on `/sheets/$instanceId`.

Recommendation for Bundle 2: introduce `instance.upgrade` as a distinct
capability in the **vocabulary**, default-mapped to current membership
(no tightening until product confirms). Do not fold upgrade into schema
publish. Share/embed stays CORE-06 (no share RPC; `notebook_record_id` is
context, not multi-embed policy).

## 8. Dependency catalogue

| Source | What it stores | Kind | Can answer “what uses this?” |
| --- | --- | --- | --- |
| `model_field_usage` | Count of JSON keys in `custom_fields` (or analog tables) | Usage count only | How many rows have the key, not who/which Sheet/Definition |
| `internal.model_field_manifest` | Field definitions on a Record at evidence time | Historical semantic manifest | Reconstruct meaning; not reverse dependents |
| `formula_dependencies` | `formula_id` + scientific `table/row/column` UUIDs | Canonical for **legacy scientific formulas** | Not FieldDefinition/CORE-02 field impact |
| SCI-010 relationships | Typed edges between `dataset_schemas` rows + optional field UUIDs | Canonical for SCI-010 only | Schema↔schema; slug-remapped on publish |
| Sheet Definition JSON | Parameter/binding/column/calculation/write-back UUIDs; `sourceFieldId`; Dataset contract `requiredFieldIds` | Canonical stable-ID **inside the document** | No reverse index; must scan version JSON |
| Sheet Instance `state` | Resolved bindings (`datasetId`, schema version via Dataset), local `fieldId`s, calculation dependency UUIDs, presentation column ids | Canonical for that Instance | No reverse index |
| `sheet_instance_definition_upgrades` | Upgrade provenance | Historical | Which Instances left a given Definition version |
| Write-back mappings | Definition JSON `targetFieldId` = bound `sourceFieldId` | Canonical in document | Scan only |
| Template records | Copied blocks; `instantiate_template` deep-copy | Derived copy, not a live Definition pin | CORE-06 gap: Templates do not yet pin Sheet Definition versions |
| `datasets.schema_version_id` | FK to CORE-02 version | Canonical | Reverse lookup is possible (index exists) |
| `dataset_versions` | Immutable Dataset Version + schema version | Canonical / historical | Reverse lookup possible |
| Record references | UUID in values / `relationship` | Canonical target id | Reverse lookup not indexed for impact UI |
| Local Sheet fields | Instance state UUIDs | Canonical local | Historical snapshots keep local ids (ADR 0021) |
| `0090` instantiate guard | Retired Definition cannot create new Instances | Lifecycle check | Prevents new use; does not list existing consumers |
| Template `archiveDependencyWarning` | Instantiation **count** in UI | Usage count | Confirmation only; archive still allowed |

Places that **cannot** currently answer “what uses this FieldDefinition /
Schema Version / Definition Version?” without a sequential scan:

- CORE-02 field → Sheet Definition columns
- CORE-02 schema version → live Datasets is OK via FK; → Definitions is not
- Model field → Sheet Record mappings / write-back
- Definition version → Templates (pin not implemented)
- Local field → would-be promoted Model/Dataset field (no promotion rows)

Do not infer those from labels or A1.

Liveness: Model options and SCI-010 schema rows emit `change_events`.
Sheet Definitions, Sheet Instances, and CORE-02 schema tables **do not**
appear in `chk_change_events_entity_type` (last widened in `0059`). Bundle 2/4
writes should add entity types when those objects become steward-managed.

## 9. CORE-04 permission handoff

`resolveSheetRecordActions` / `SHEET_RECORD_CAPABILITY_LIMITATION`:

- Definition `actions` configure UI visibility only.
- `search_sheet_records`, `create_and_link_sheet_record`,
  `commit_sheet_record_batch`, `create_model_record` remain
  workspace-member RPCs.
- Outsiders still fail `42501`.
- No server link-only principal.

CORE-05 capability vocabulary should include `records.link` vs
`records.create` (and probably `records.update`) **separate from**
`schema.*`. Default map: current members keep both until a role (for
example a true read-only `viewer`) is defined. Do not use schema
stewardship to hide Record create.

## 10. Lifecycle versus ADR 0023

| Object | Archive | Retire | Restore | Hard delete | Existing refs |
| --- | --- | --- | --- | --- | --- |
| Records / Templates | `archive_record` / `restore_record`; member | Template status vocabulary (validated/active) | Yes | `deleted_at` cleared on restore; no general hard-delete RPC | Archived templates cannot instantiate (`SB006`) |
| Model fields | — | `retire_model_field`; values remain; retired keys immutable | No un-retire RPC | Table DELETE revoked | Historical custom_fields remain |
| SCI-010 schema | — | Publish retires prior slug revision; field retire | No | Owner DELETE policy on schema tables | Scientific tables bind `dataset_schema_id` ON DELETE SET NULL |
| CORE-02 schema | — | lifecycle on definition/version | Not productised | No DELETE grant; Dataset FK RESTRICT | Existing Datasets keep schema_version_id |
| Sheet Definition | — | `retire_sheet_definition` / version; `0090` blocks new instantiate | No | No table DELETE | Existing Instances keep pinned version id |
| Sheet Instance | `archive_sheet_instance` | — | No restore RPC found | Trigger forbids DELETE | Archived Instances not composable |
| Dataset | `lifecycle` active/archived; composition may read archived sources for existing Instances (`0090`) | — | Not audited as a steward flow | RESTRICT from schema version | Matches ADR 0023 “existing consumers resolve” |
| Category options | — | retire option | — | — | Embedded options; governed vocabularies are **not a product table yet** (ADR 0025 deferred) |
| Submitted evidence | lock/amend | — | — | Protected by review/signature flows | ADR 0023 hard-delete block not generalised to schema objects |

Inconsistencies for 05.10:

- Restore exists for Records, not Definitions/Instances/CORE-02 schemas.
- SCI-010 SET NULL on scientific table bind can silently drop schema
  identity if a schema row is deleted — unsafe versus ADR 0023.
- No dependency preview before retire except Sheet Definition instantiate
  guard and Template usage **warning**.
- `viewer` membership does not implement “exclude from new use”.

## 11. Implications for Bundles 2–5

Provisional five-bundle plan remains appropriate with these adjustments:

1. **Bundle 2 (05.2/05.3)** — Converge helpers and enforce capabilities.
   Do **not** migrate SCI-010 data. Do **not** tighten Instance upgrade.
   Do **not** invent grant tables unless the role decision fails the steward
   exit gate. Include CORE-04.9 server Record create/link only if the
   role decision provides a principal to attach it to; otherwise keep the
   limitation documented and implement the helper seam.

2. **Bundle 3 (05.4/05.10)** — Reverse indexes over **stable UUIDs** in
   CORE-02 fields, Sheet Definition JSON, Instance bindings, Dataset FKs.
   Treat SCI-010 relationships as a compatibility query. Lifecycle work
   should prefer CORE-02 + Definitions + Records; flag SCI-010 DELETE SET
   NULL as unsafe.

3. **Bundle 4 (05.5–05.8)** — Model evolution on existing Model RPCs;
   Dataset version evolution **only** on CORE-02; promotion writes CORE-02
   or Model fields, never SCI-010 by default.

4. **Bundle 5 (05.9/05.11)** — Steward UI on canonical objects; `/schemas`
   remains legacy until a later migration. Do not build two editors.

Bundle 2 remains blocked on the decisions in §13 of the CORE-05.1 report.

## 12. Documentation corrections made with this task

- `docs/core/NEXT.md`: ADR 0021 filename; CORE-05.1 completion; next task
  pointer held at 05.2 pending decisions.
- `docs/core/CORE_MIGRATION.md`: stale “CORE-01.3 active” programme line.
- `docs/core/README.md`: CORE-05 title no longer lists Views as a Core epic
  name.
- `docs/core/tasks/CORE-05.md`: 05.1 completion evidence.

## 13. Validation

Documentation-only. Focused baseline already green on this HEAD:

- Unit/component: 5 files / 70 tests
  (`field-definition`, `model-fields`, `templates`, `admin-model-fields`,
  `admin` route).
- DB: 3 files / 47 tests
  (`model-fields`, `dataset-schema-registry`, `workspace-admin`).

Full `pnpm validate` not rerun (CORE-04.11 remains 166 / 1,893 and
`pnpm test:db` 61 / 679).
