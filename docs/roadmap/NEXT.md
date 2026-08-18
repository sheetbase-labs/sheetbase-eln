# Sheetbase Roadmap — Current Work

> **Implementation and planning agents start here for post-Core work.**

## Programme

**Product & Platform Consolidation**

PC-00 is **accepted**. Audit: [`audits/PC-00.md`](./audits/PC-00.md).

CORE-01–06 and Core Hardening remain closed. Do not reopen settled Core architecture without concrete implementation evidence.

Delivery priority uses only **medium** and **low**. Nothing is queued as high.

**Merged `main` HEAD for this hand-off:** `df1fcb2` (`docs: apply no-compatibility rule to future roadmap work`).

## Active work

The roadmap supports **parallel streams**. Agents take **one assigned stream/task**. Ready does not mean “do every Ready row”. **Do not start a Ready stream until it is assigned.**

| Stream | Active task | Model | Status |
| --- | --- | --- | --- |
| PC | — | — | PC-01 and PC-02 complete; PC-03 remains later |
| API | API-07 — Core External Allowlist Cut-over | Medium | Complete on branch |
| DATA | DATA-01 — Import Framework | Medium | Ready candidate |
| GOV | — | — | GOV-01 complete; GOV-02 requires an ADR |
| PLAT | — | — | Headers slice complete; remaining PLAT-03 queued |
| COLLAB | — | — | Planned |
| SCI | — | — | Planned |
| INT | — | — | Planned |
| AUTO | — | — | Planned later |

### Immediate execution shape

```text
merged  API-01  Public API contract (#40) @ b306654
merged  PC-01   Canonical Sheet + blank Notebook + submit (#41) @ 7cca216
merged  PLAT-03 headers slice (#43) @ 3c3c8ee
merged  PC-02   Dataset and Record product workflows (#44) @ b01b029
merged  GOV-01  viewer read-only (#45) @ 1256258
merged  hand-off regenerate (#46) @ 52b304b
merged  API-02  workspace service credentials (#47) @ df27039

complete on branch
  API-07  [Medium] Core Dataset/Sheet/Notebook external allowlist cut-over

candidates (assign one stream; do not fan out)
  DATA-01 [Medium] import/paste against the canonical Sheet + Dataset product
```

## Stream briefs

### PC — complete for this batch

Task: [`tasks/PC.md`](./tasks/PC.md)

- **PC-01 complete** (`#41` / `7cca216`): one Sheet experience, blank Notebook enabling slice, submit enabling slice, specialist tools demoted from default nav. Calculation dependencies follow the existing formula IR.
- **PC-02 complete** (`#44` / `b01b029`): Dataset create/snapshot/live edit and reagent create; strict numeric coercion; historical Dataset Versions render the pinned Schema Version. Sheet Dataset bind remains the canonical Sheet Instance path (H2), not a second bind model.

**PC-03** (full Notebook product) remains later. Do not start it from this hand-off. Do not reopen PC-01/PC-02.

### API — API-07 complete on branch

Task: [`tasks/API.md`](./tasks/API.md)  
Prompt: [`prompts/API.md`](./prompts/API.md)

**API-01 complete** (`#40` / `b306654`): `docs/public-api-contract.md` v0.1.1. Dataset data scopes are distinct from governed `schema:*`. `sheets:write` does not grant Sheet Definition authorship.

**API-02 complete** (`#47` / `df27039`): workspace service credentials. Canonical API-01 scopes only; `scientific:*` removed. Rotation copies scopes and expiry exactly. Optional credential expiry; JWT TTL 300s. Personal tokens, named service-account principals, and credential activity-audit events remain later API work — not API-07.

**API-07 complete** (this branch): `requiredScopes()` maps Core Dataset/Sheet/Notebook RPCs to canonical scopes. Schema-authoring RPCs, files and specialist surfaces stay fail-closed. Do not start API-03 (OpenAPI) from this hand-off.

### DATA — DATA-01 (Medium, Ready candidate)

Task: [`tasks/DATA.md`](./tasks/DATA.md)  
Prompt: [`prompts/DATA.md`](./prompts/DATA.md)

PC-01 Sheet interaction and PC-02 Dataset product are on `main`. **DATA-01** may be assigned: CSV/XLSX/TSV/JSON/clipboard import with preview, mapping and validate-before-commit through canonical Dataset/Record writers. Do not build a second Dataset write path.

### GOV — GOV-01 complete

Task: [`tasks/GOV.md`](./tasks/GOV.md)

**GOV-01 complete** (`#45` / `1256258`): workspace `viewer` is read-only. `is_workspace_writer` plus leftover-inventory migration abort. SELECT remains membership-based. `api_client` unchanged.

**GOV-02** (organisation model) stays queued and **requires an ADR** before ownership/RLS changes. Do not start it from this hand-off.

### PLAT — headers slice complete; remainder queued

Task: [`tasks/PLAT.md`](./tasks/PLAT.md)

**PLAT-03 headers slice complete** (`#43` / `3c3c8ee`): security headers and transitional CSP, including documented `unsafe-inline`. Remaining PLAT-03 (general API rate limits, nonce CSP, SAST, backup encryption, etc.) stays queued. Do not expand a new PR into that remainder unless assigned.

## Dependencies

- DATA-01 is unblocked by PC-01 (and should use PC-02 Dataset product contracts).
- API-07 Core external allowlist cut-over is complete on branch. API-03 is not automatically Ready.
- PC-03 is not automatically Ready.
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
- do not start PC-03, GOV-02, remaining PLAT-03, COLLAB, SCI, INT or AUTO from this hand-off unless later assigned;
- do not reopen FieldDefinition, Dataset, Definition/Instance, Template version or frozen-evidence architecture without a real defect;
- do not create another Dataset, Sheet, Template or capability system;
- do not treat the browser as the only future client;
- do not perpetuate `scientific:*` / scientific-table architecture as the future public API.

## Expected hand-off from Ready candidates (when assigned)

- **DATA-01:** laboratory files/pastes become governed Dataset/Record state with validation before commit, using canonical writers.
