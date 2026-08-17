# Sheetbase Roadmap — Current Work

> **Implementation and planning agents start here for post-Core work.**

## Programme

**Product & Platform Consolidation**

PC-00 is **accepted**. Audit: [`audits/PC-00.md`](./audits/PC-00.md).

CORE-01–06 and Core Hardening remain closed. Do not reopen settled Core architecture without concrete implementation evidence.

Delivery priority uses only **medium** and **low**. Nothing is queued as high.

## Active work

The roadmap supports **parallel streams**. Agents take **one assigned stream/task**. Ready does not mean “do every Ready row”.

| Stream | Active task | Model | Status |
| --- | --- | --- | --- |
| PC | PC-01 — Canonical Sheet Experience | Medium | Ready |
| API | API-01 — Public API Contract | Low | Ready |
| DATA | — | — | Waiting on PC-01 |
| GOV | GOV-01 — Role & Capability Productisation | Low initially | Queued |
| PLAT | PLAT-03 — Security Hardening | Low initially | Queued |
| COLLAB | — | — | Planned |
| SCI | — | — | Planned |
| INT | — | — | Planned |
| AUTO | — | — | Planned later |

### Immediate execution shape

```text
PC-01 [Medium]
    |
    +-- blank Notebook enabling slice
    +-- canonical Sheet experience
    +-- specialist tools demoted from default nav (keep routes)
    `-- submit enabling slice

API-01 [Low]   (parallel; contract/docs only)
    |
    +-- public resource contract
    +-- Core-domain scope proposal
    +-- compatibility/deprecation plan
    `-- correct stale external API documentation
```

## Stream briefs

### PC — PC-01 (Medium, Ready)

Task: [`tasks/PC.md`](./tasks/PC.md) (PC-01)  
Prompt: [`prompts/PC.md`](./prompts/PC.md)

Canonical spreadsheet-native Sheet experience spanning ad-hoc and composed states, using existing CORE-03/H2 RPCs.

**Include a thin PC-03 enabling slice only:**

- create a blank experiment/Notebook;
- submit the Notebook through the existing revision/evidence contract (`preview_submission_digest` / `submit_record_revision`).

These exist so the canonical Sheet workflow can be exercised end-to-end. **Do not** broaden into the full PC-03 Notebook epic.

Also **demote specialist tools from default navigation** (do not delete). Keep routes reachable as secondary. They must not compete with the canonical product during consolidation.

**Do not** change `viewer` semantics (GOV-01). **Do not** start DATA-01, GOV-01 or PLAT-03.

### API — API-01 (Low, Ready)

Task: [`tasks/API.md`](./tasks/API.md) (API-01)  
Prompt: [`prompts/API.md`](./prompts/API.md)

May start **in parallel** with PC-01. Stay **contract / audit / documentation** focused.

Inspect the actual server/API implementation. Produce:

- canonical public resource/operations contract;
- Core-domain scope model (retire `scientific:*` as the future public API);
- compatibility/deprecation plan if any real client still depends on old scopes;
- corrections to stale `docs/external-api.md`.

If implementation would require consequential server architecture, migrations, RLS, transactions or other Medium-level work, **stop at the contract boundary** and queue that implementation separately.

### DATA — waiting

Do not start DATA-01. Refine import/paste against the canonical Sheet interaction established by PC-01. Task notes: [`tasks/DATA.md`](./tasks/DATA.md).

### GOV — GOV-01 (Low initially, Queued)

Accepted decision: **`viewer` means read-only.** Recorded as a GOV-01 requirement. Do not fix inside PC-01.

When started, GOV-01 must handle migration, RLS/capability semantics and permission regression testing explicitly. Task: [`tasks/GOV.md`](./tasks/GOV.md). Prompt: [`prompts/GOV.md`](./prompts/GOV.md).

### PLAT — PLAT-03 (Low initially, Queued)

Do not implement as part of PC-01 or API-01. Queue security headers, general API rate limits and related hardening. Stale external-API documentation belongs to API-01, not PLAT-03. Task: [`tasks/PLAT.md`](./tasks/PLAT.md).

## Dependencies

- PC-01 enabling slices (blank Notebook + submit) unblock end-to-end Sheet proof; they are **in** PC-01, not a separate Ready PC-03 epic.
- DATA-01 waits for PC-01 paste/Sheet interaction.
- API-01 does not wait for PC-01, but must not invent a second Sheet/Dataset/Notebook model.
- GOV-01 and PLAT-03 are queued; they must not be pulled into Ready streams.
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

- do not implement every Ready stream in one session;
- do not start DATA-01, GOV-01, PLAT-03, COLLAB, SCI, INT or AUTO from this hand-off;
- do not broaden the PC-01 Notebook enabling slice into full PC-03;
- do not delete specialist tools; demote them from default nav only;
- do not make `viewer` read-only inside PC-01;
- do not perpetuate `scientific:*` / scientific-table architecture as the future public API;
- do not build a visual Pipeline designer or an AI-specific data/permission model;
- do not reopen FieldDefinition, Dataset, Definition/Instance, Template version or frozen-evidence architecture without a real defect;
- do not create another Dataset, Sheet, Template or capability system;
- do not treat the browser as the only future client.

## Expected hand-off from Ready streams

- **PC-01:** one Sheet experience from a blank Notebook through submit, specialist tools secondary in nav, GOV-01/`viewer` untouched.
- **API-01:** published contract, Core-domain scope proposal, deprecation plan, corrected external API docs; implementation queued separately if it exceeds Low contract work.
