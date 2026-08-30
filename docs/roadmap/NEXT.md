# Sheetbase Roadmap — Current Work

> **Implementation and planning agents start here for post-Core work.**

## Programme

**Product & Platform Consolidation**

PC-00 is **accepted**. Audit: [`audits/PC-00.md`](./audits/PC-00.md).

CORE-01–06 and Core Hardening remain closed. Do not reopen settled Core architecture without concrete implementation evidence.

Delivery priority uses only **medium** and **low**. Nothing is queued as high.

**Merged `main` HEAD for this hand-off:** `1d7a06a` (`feat(PC-05): canonical Steward configuration workspace` / `#54`).

## Active work

The roadmap supports **parallel streams**. Agents take **one assigned stream/task**. Ready does not mean “do every Ready row”. **Do not start a Ready stream until it is assigned.**

| Stream | Active task     | Model | Status                                                                                                                                                                                                                                                                                                            |
| ------ | --------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PC     | —               | —     | PC-06 is ready to merge as #55; do not start a new PC task yet.                                                                                                                                                                                                                                                   |
| API    | —               | —     | API foundation complete in `#56`: API-01 contract; API-02 service credentials + personal tokens + lifecycle audit; API-07 allowlist cut-over; API-03 OpenAPI for both credential kinds. Do not start API-04/05/06                                                                                                 |
| DATA   | —               | —     | DATA-01 complete; DATA-02 remains later                                                                                                                                                                                                                                                                           |
| GOV    | —               | —     | GOV-01 complete; GOV-02 requires an ADR                                                                                                                                                                                                                                                                           |
| PLAT   | —               | —     | Headers slice complete; remaining PLAT-03 queued                                                                                                                                                                                                                                                                  |
| COLLAB | —               | —     | COLLAB-01–04 complete (#69, #73, #71, #72). Liveblocks presence/comments/notifications with Sheetbase-authoritative permissions; sheet cell/range anchors queued behind canonical Sheet row identity. See `docs/collaboration.md`                                                                                 |
| SCI    | SCI-04 | —     | SCI-04 scientific visualisation maturity on this branch. SCI-01–03 remain the canonical foundation. Do not start API-04/05/06, AUTO-04/05 or GOV-02. |
| INT    | INT-01 + INT-02 | —     | Connector framework (`api.connectors` / `connector_runs`, `integrations.manage`, sealed secrets, parser registry) proven end-to-end by plate-reader instrument ingestion; see `docs/integrations.md`. INT-03 enterprise connectors (S3 + read-only PostgreSQL) implemented on `feat/int-03-enterprise-connectors` |
| AUTO   | —               | —     | AUTO-01/02/03 complete (deterministic, versioned Pipelines — `docs/pipelines.md`, ADR 0042): versioned Definitions, sandboxed SQL execution, manual/interval/daily/event triggers, run history, provenance, `/pipelines` authoring surface. AUTO-04/05 later                                                      |

### Immediate execution shape

```text
merged  API-01  Public API contract (#40) @ b306654
merged  PC-01   Canonical Sheet + blank Notebook + submit (#41) @ 7cca216
merged  PLAT-03 headers slice (#43) @ 3c3c8ee
merged  PC-02   Dataset and Record product workflows (#44) @ b01b029
merged  GOV-01  viewer read-only (#45) @ 1256258
merged  hand-off regenerate (#46) @ 52b304b
merged  API-02  workspace service credentials (#47) @ df27039
merged  API-07  Core Dataset/Sheet external allowlist (#50) @ 30496db
merged  DATA-01 import laboratory files (#49) @ 37e3c52
merged  API-03  service-credential OpenAPI (#51) @ 2cd3a12
feat/api-02-completion  API-02 completion + API-03 reconciliation (#56: personal tokens, credential audit events, external OpenAPI for both kinds)
stacked  SCI-01..03 Scientific charting, analysis framework, notebook analysis blocks (+ revision binding, freezable facets, fit-curve overlay, storage test fix)
merged  PC-04   Templates and reusable science (#53) @ 3c8b8df
merged  PC-05   Canonical Steward configuration workspace (#54) @ 1d7a06a
feat/data-03-file-platform      DATA-03 file & attachment platform consolidation (#66)
feat/data-04-global-search      DATA-04 global search across datasets/sheets/templates (#67)
feat/data-02-export             DATA-02 export & portability (#68, stacked on #66)
feat/int-01-int-02-connectors   INT-01 Generic Connector Framework + INT-02 scientific instrument ingestion
```

## Stream briefs

### PC — PC-06 Golden Workflow Consolidation

Task: [`tasks/PC.md`](./tasks/PC.md)

- **PC-01 complete** (`#41` / `7cca216`): one Sheet experience, blank Notebook enabling slice, submit enabling slice, specialist tools demoted from default nav. Calculation dependencies follow the existing formula IR.
- **PC-02 complete** (`#44` / `b01b029`): Dataset create/snapshot/live edit and reagent create; strict numeric coercion; historical Dataset Versions render the pinned Schema Version. Sheet Dataset bind remains the canonical Sheet Instance path (H2), not a second bind model.
- **PC-03 complete** (`#52`): Notebook product chrome around existing records/blocks/Sheet Instance/REV-002/H3 contracts. Submit, sign and amend stay session-only.
- **PC-04 complete** (`#53` / `3c8b8df`): versioned Notebook Templates, placements/parameters, instantiate, explicit upgrade, Sheet Definition catalogue and consumer upgrade. `/templates` remains the scientist library.
- **PC-05 complete** (`#54` / `1d7a06a`): `/configure` is the canonical Steward data-language plane. Model fields leave Administration (`/admin/model-fields` redirects). Vocabularies are existing category sources (ADR 0025), not a second vocabulary product. Calculation promotion uses existing RPCs. Capability inspector remains.
- **PC-06 ready to merge** (`#55`): consolidates the six existing golden workflows through product hand-offs and workflow-level acceptance evidence. It does not add a second workflow system or broaden into AUTO/SCI.

### API — closed for this assignment

Task: [`tasks/API.md`](./tasks/API.md)
Prompt: [`prompts/API.md`](./prompts/API.md)

**API-01 complete** (`#40` / `b306654`): `docs/public-api-contract.md` v0.1.1. Dataset data scopes are distinct from governed `schema:*`. `sheets:write` does not grant Sheet Definition authorship.

**API-02 complete** (`#47` / `df27039`): workspace service credentials. Canonical API-01 scopes only; `scientific:*` removed. Rotation copies scopes and expiry exactly. Optional credential expiry; JWT TTL 300s. Personal tokens, named service-account principals, and credential activity-audit events remain later API work — not API-07.

**API-07 complete** (`#50` / `30496db`): `requiredScopes()` maps Core Dataset/Sheet RPCs to canonical scopes. Mapped Dataset/Sheet data-plane writes succeed for `api_client` with `credential_id` attribution. Submit, sign, amend and revision checks stay off the credential allowlist.

**API-03 complete** (`#51` / `2cd3a12`; renamed and extended in `#56`): OpenAPI 3.1 at `docs/openapi/external-api-v0.json` describes only operations an external credential can complete, for both service credentials and personal tokens. Human attestation RPCs are omitted. `reviews:write` is not a usable credential submission operation.

**API-02 remainder complete** (`#56`, `feat/api-02-completion`): personal tokens (user-scoped credentials acting as the creating member), credential lifecycle audit events in workspace `change_events` (entity type `api_credential`), and API-03 reconciliation — the OpenAPI spec is renamed `external-api-v0.json` and documents both credential kinds on the one fail-closed surface. The API foundation (API-01/02/03 + API-07) is complete; SDK work (API-04/05) can start next. Named service-account principals remain queued and require an ADR.

### DATA — programme complete

Task: [`tasks/DATA.md`](./tasks/DATA.md)
Prompt: [`prompts/DATA.md`](./prompts/DATA.md)

**DATA-01 complete:** CSV, TSV, JSON, XLSX and clipboard import with preview, column mapping and validate-before-commit. Dataset writes use `validate_dataset_row_batch` / `commit_dataset_row_batch`. Record writes use `validate_sheet_record_batch` / `create_model_record`. Coercion fails closed. Rows pin to the Dataset's current Schema Version. Sheet grid paste remains PC-01; plate CSV is not the product import path.

**DATA-02 complete (#68):** streaming Dataset/Version/Sheet/Record exports (CSV/TSV/JSON/NDJSON/XLSX/Parquet), deterministic revision evidence ZIP via the consolidated `api.revision_evidence_package`, `api.data_exports` receipts, live-vs-frozen labelling proven by test. **DATA-03 complete (#66):** file platform consolidated as the one canonical subsystem with API-level isolation/boundary proofs and `docs/file-platform.md`. **DATA-04 complete (#67):** global search covers records, files, Datasets, Sheet Instances and Notebook Templates in one RLS-filtered RPC with object-class facets; PostgreSQL FTS only.

### GOV — GOV-01 complete

Task: [`tasks/GOV.md`](./tasks/GOV.md)

**GOV-01 complete** (`#45` / `1256258`): workspace `viewer` is read-only. `is_workspace_writer` plus leftover-inventory migration abort. SELECT remains membership-based. `api_client` unchanged.

**GOV-02** (organisation model) stays queued and **requires an ADR** before ownership/RLS changes. Do not start it from this hand-off.

### PLAT — headers slice complete; remainder queued

Task: [`tasks/PLAT.md`](./tasks/PLAT.md)

**PLAT-03 headers slice complete** (`#43` / `3c3c8ee`): security headers and transitional CSP, including documented `unsafe-inline`. Remaining PLAT-03 (general API rate limits, nonce CSP, SAST, backup encryption, etc.) stays queued. Do not expand a new PR into that remainder unless assigned.

## Dependencies

- The DATA programme (import/export/files/search) is complete pending review of #66/#67/#68.
- API-07 Core external allowlist cut-over is complete (`#50`). Submit, sign, amend and revision checks stay human-session-only. API-03 OpenAPI is complete on this branch.
- PC-05 Steward `/configure` is complete (`#54`). PC-06 Golden Workflows is ready to merge (`#55`).
- GOV-02 is not Ready without an ADR.
- Remaining PLAT-03 is queued, not a new Ready stream.
- AUTO-01/02/03 are complete; AUTO-04/05 remain later work and must not start from this hand-off.

## Required reading (any stream)

1. [`README.md`](./README.md)
2. [`PRODUCT_DIRECTION.md`](./PRODUCT_DIRECTION.md)
3. [`PROGRAMME_MAP.md`](./PROGRAMME_MAP.md)
4. [`audits/PC-00.md`](./audits/PC-00.md) (accepted findings and decisions)
5. The task file and prompt for the **assigned** stream only
6. [`../core/CORE_HARDENING.md`](../core/CORE_HARDENING.md)
7. relevant accepted ADRs (especially 0020, 0037, 0038)

## Do not

- do not implement every Ready candidate in one session;
- do not start GOV-02, remaining PLAT-03, COLLAB, SCI, INT or AUTO-04/05 from this hand-off unless later assigned;
- do not reopen FieldDefinition, Dataset, Definition/Instance, Template version or frozen-evidence architecture without a real defect;
- do not create another Dataset, Sheet, Template or capability system;
- do not create a second Pipeline or automation model — AUTO-01/02/03 defined the canonical one (`docs/pipelines.md`, ADR 0042);
- do not treat the browser as the only future client;
- do not perpetuate `scientific:*` / scientific-table architecture as the future public API.

## Expected hand-off from Ready candidates (when assigned)

- **PC-06:** close workflow hand-offs and add workflow-level evidence; do not invent new Core contracts.
