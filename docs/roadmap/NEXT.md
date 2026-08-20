# Sheetbase Roadmap — Current Work

> **Implementation and planning agents start here for post-Core work.**

## Programme

**Product & Platform Consolidation**

PC-00 is **accepted**. Audit: [`audits/PC-00.md`](./audits/PC-00.md).

CORE-01–06 and Core Hardening remain closed. Do not reopen settled Core architecture without concrete implementation evidence.

Delivery priority uses only **medium** and **low**. Nothing is queued as high.

**Merged `main` HEAD for this hand-off:** `3c8b8df` (`feat(PC-04): templates and reusable science surfaces` / `#53`).

## Active work

The roadmap supports **parallel streams**. Agents take **one assigned stream/task**. Ready does not mean “do every Ready row”. **Do not start a Ready stream until it is assigned.**

| Stream | Active task | Model  | Status                                                                   |
| ------ | ----------- | ------ | ------------------------------------------------------------------------ |
| PC     | PC-06       | Medium | Golden Workflow Consolidation is active on `GWP/pc-06-golden-workflows`. |
| API    | —           | —      | API-01/02/03/07 complete on `main`; do not start API-04/05/06            |
| DATA   | —           | —      | DATA-01 complete; DATA-02 remains later                                  |
| GOV    | —           | —      | GOV-01 complete; GOV-02 requires an ADR                                  |
| PLAT   | —           | —      | Headers slice complete; remaining PLAT-03 queued                         |
| COLLAB | —           | —      | Planned                                                                  |
| SCI    | —           | —      | Planned                                                                  |
| INT    | —           | —      | Planned                                                                  |
| AUTO   | —           | —      | Planned later                                                            |

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
merged  PC-04   Templates and reusable science (#53) @ 3c8b8df
```

## Stream briefs

### PC — PC-06 Golden Workflow Consolidation

Task: [`tasks/PC.md`](./tasks/PC.md)

- **PC-01 complete** (`#41` / `7cca216`): one Sheet experience, blank Notebook enabling slice, submit enabling slice, specialist tools demoted from default nav. Calculation dependencies follow the existing formula IR.
- **PC-02 complete** (`#44` / `b01b029`): Dataset create/snapshot/live edit and reagent create; strict numeric coercion; historical Dataset Versions render the pinned Schema Version. Sheet Dataset bind remains the canonical Sheet Instance path (H2), not a second bind model.
- **PC-03 complete** (`#52`): Notebook product chrome around existing records/blocks/Sheet Instance/REV-002/H3 contracts. Submit, sign and amend stay session-only.
- **PC-04 complete** (`#53` / `3c8b8df`): versioned Notebook Templates, placements/parameters, instantiate, explicit upgrade, Sheet Definition catalogue and consumer upgrade. `/templates` remains the scientist library.
- **PC-05 complete** (`#54` / `1d7a06a`): `/configure` is the canonical Steward data-language plane. Model fields leave Administration (`/admin/model-fields` redirects). Vocabularies are existing category sources (ADR 0025), not a second vocabulary product. Calculation promotion uses existing RPCs. Capability inspector remains.
- **PC-06 active** (`GWP/pc-06-golden-workflows`): consolidate the six existing golden workflows through product hand-offs and workflow-level acceptance evidence. Do not add a second workflow system or broaden into AUTO/SCI.

### API — closed for this assignment

Task: [`tasks/API.md`](./tasks/API.md)
Prompt: [`prompts/API.md`](./prompts/API.md)

**API-01 complete** (`#40` / `b306654`): `docs/public-api-contract.md` v0.1.1. Dataset data scopes are distinct from governed `schema:*`. `sheets:write` does not grant Sheet Definition authorship.

**API-02 complete** (`#47` / `df27039`): workspace service credentials. Canonical API-01 scopes only; `scientific:*` removed. Rotation copies scopes and expiry exactly. Optional credential expiry; JWT TTL 300s. Personal tokens, named service-account principals, and credential activity-audit events remain later API work — not API-07.

**API-07 complete** (`#50` / `30496db`): `requiredScopes()` maps Core Dataset/Sheet RPCs to canonical scopes. Mapped Dataset/Sheet data-plane writes succeed for `api_client` with `credential_id` attribution. Submit, sign, amend and revision checks stay off the credential allowlist.

**API-03 complete** (`#51` / `2cd3a12`): OpenAPI 3.1 at `docs/openapi/service-credentials-v0.json` describes only operations an API key can complete. Human attestation RPCs are omitted. `reviews:write` is not a usable credential submission operation. Do not start API-04/05/06.

### DATA — DATA-01 complete

Task: [`tasks/DATA.md`](./tasks/DATA.md)
Prompt: [`prompts/DATA.md`](./prompts/DATA.md)

**DATA-01 complete:** CSV, TSV, JSON, XLSX and clipboard import with preview, column mapping and validate-before-commit. Dataset writes use `validate_dataset_row_batch` / `commit_dataset_row_batch`. Record writes use `validate_sheet_record_batch` / `create_model_record`. Coercion fails closed. Rows pin to the Dataset's current Schema Version. Sheet grid paste remains PC-01; plate CSV is not the product import path.

**DATA-02 / DATA-03 / DATA-04** remain later. Do not start them from this hand-off.

### GOV — GOV-01 complete

Task: [`tasks/GOV.md`](./tasks/GOV.md)

**GOV-01 complete** (`#45` / `1256258`): workspace `viewer` is read-only. `is_workspace_writer` plus leftover-inventory migration abort. SELECT remains membership-based. `api_client` unchanged.

**GOV-02** (organisation model) stays queued and **requires an ADR** before ownership/RLS changes. Do not start it from this hand-off.

### PLAT — headers slice complete; remainder queued

Task: [`tasks/PLAT.md`](./tasks/PLAT.md)

**PLAT-03 headers slice complete** (`#43` / `3c3c8ee`): security headers and transitional CSP, including documented `unsafe-inline`. Remaining PLAT-03 (general API rate limits, nonce CSP, SAST, backup encryption, etc.) stays queued. Do not expand a new PR into that remainder unless assigned.

## Dependencies

- DATA-01 is complete (canonical Dataset/Record import). DATA-02 export is not started.
- API-07 Core external allowlist cut-over is complete (`#50`). Submit, sign, amend and revision checks stay human-session-only. API-03 OpenAPI is complete on this branch.
- PC-05 Steward `/configure` is complete (`#54`). PC-06 Golden Workflows is active.
- GOV-02 is not Ready without an ADR.
- Remaining PLAT-03 is queued, not a new Ready stream.
- AUTO remains planned later.

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
- do not start GOV-02, remaining PLAT-03, COLLAB, SCI, INT or AUTO from this hand-off unless later assigned;
- do not reopen FieldDefinition, Dataset, Definition/Instance, Template version or frozen-evidence architecture without a real defect;
- do not create another Dataset, Sheet, Template or capability system;
- do not treat the browser as the only future client;
- do not perpetuate `scientific:*` / scientific-table architecture as the future public API.

## Expected hand-off from Ready candidates (when assigned)

- **PC-06:** close workflow hand-offs and add workflow-level evidence; do not invent new Core contracts.
