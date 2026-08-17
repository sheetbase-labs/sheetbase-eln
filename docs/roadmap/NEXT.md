# Sheetbase Roadmap — Current Work

> **Implementation and planning agents start here for post-Core work.**

## Programme

**Product & Platform Consolidation**

PC-00 is **accepted**. Audit: [`audits/PC-00.md`](./audits/PC-00.md).

CORE-01–06 and Core Hardening remain closed. Do not reopen settled Core architecture without concrete implementation evidence.

Delivery priority uses only **medium** and **low**. Nothing is queued as high. Child workers use **Medium** or **Low** only — do not substitute other model tiers.

## Active work

The roadmap supports **parallel streams**. Agents take **one assigned stream/task**. Ready does not mean “do every Ready row”.

| Stream | Active task | Model | Status |
| --- | --- | --- | --- |
| PC | PC-01 — Canonical Sheet Experience | Medium | Merge-ready ([#41](https://github.com/phlohouse/sheetbase-eln/pull/41)) |
| PC | PC-02 — Dataset & Record Product Workflows | Medium | Ready |
| API | API-01 — Public API Contract | Low | Merge-ready ([#40](https://github.com/phlohouse/sheetbase-eln/pull/40)) |
| DATA | DATA-01 — Import Framework | — | Waiting on PC-01 merge |
| GOV | GOV-01 — Role & Capability Productisation | Medium | Queued (RLS/migration is Medium, not Low) |
| PLAT | PLAT-03 — Security Hardening (headers slice) | Low | Ready |
| COLLAB | — | — | Planned |
| SCI | — | — | Planned |
| INT | — | — | Planned |
| AUTO | — | — | Planned later |

PC-01 and API-01 remain open PRs against `main` at `f2dfa25`. Do **not** merge them unless explicitly instructed. Do **not** restack implementation on those branches unless a stream depends on unmerged files.

### Immediate execution shape

```text
PC-01 [Medium]   merge-ready #41   (do not merge unless instructed)
API-01 [Low]     merge-ready #40   (do not merge unless instructed)

PC-02 [Medium]   Ready from current main
    |
    +-- Dataset catalogue create / snapshot / controlled live edit
    +-- Record registry gaps (reagent create; first-class Dataset/Record UX)
    `-- do not build DATA-01 CSV/XLSX import framework
    `-- do not change viewer (GOV-01)
    `-- do not restack onto the PC-01 Sheet PR

PLAT-03 [Low]    Ready from current main (headers slice only)
    |
    +-- CSP / security headers
    `-- stop at Low boundary; queue rate-limit/SAST/backup work if Medium
```

## Stream briefs

### PC — PC-01 (Medium, merge-ready)

PR: [#41](https://github.com/phlohouse/sheetbase-eln/pull/41) on `gwp/pc-01-canonical-sheet-151b`.

Controller review accepted the epic with known limitations (no conflict-mapping workspace; Dataset bind via Definition parameters + H2; submit uses the current user as reviewer). Do not reopen PC-01 unless review finds a defect.

### PC — PC-02 (Medium, Ready)

Task: [`tasks/PC.md`](./tasks/PC.md) (PC-02)  
Prompt: [`prompts/PC.md`](./prompts/PC.md)

Make Datasets and Records first-class outside Notebook/Sheet infrastructure. PC-00: `/datasets` is read-only; Dataset create/snapshot/live-edit RPCs exist; reagent create UI is missing.

**Do not** implement the DATA-01 import framework (CSV/XLSX mapping). Paste into Dataset live edit may use existing Core writers only. **Do not** change `viewer`. **Do not** edit PC-01 Sheet files (`canonical-sheet-workspace`, nav More group) — that work is on #41.

Branch from current `main` (`f2dfa25` until #41 merges).

### API — API-01 (Low, merge-ready)

PR: [#40](https://github.com/phlohouse/sheetbase-eln/pull/40). Contract published; Core allowlist cut-over is **not** started. Do not start API-02 until #40 is merged (shared `docs/external-api.md` / `external-token.ts`).

### DATA — waiting

Do not start DATA-01 until PC-01 (#41) is on `main`. Paste/import must target the canonical Sheet, which is not on `main` yet.

### GOV — GOV-01 (Medium, Queued)

Accepted decision: **`viewer` means read-only.** Implementation requires migration, RLS/`has_capability` agreement and permission regression tests — that is **Medium**, not Low. Do not start in this round (capability changes would collide with PC-02 Dataset/Record UI tests).

### PLAT — PLAT-03 (Low, Ready — headers slice)

Task: [`tasks/PLAT.md`](./tasks/PLAT.md)  
Prompt: [`prompts/PLAT.md`](./prompts/PLAT.md)

Low slice only: application CSP/security headers, tested and documented. **Do not** implement general API rate-limit architecture, SAST pipelines, backup encryption, or `viewer` read-only. If rate limits or SECURITY DEFINER audit need Medium work, document and queue.

Stale external-API documentation is API-01 (#40), not PLAT-03.

## Dependencies

- PC-02 does not wait for PC-01 merge (Dataset/Record surfaces are separate from the Sheet PR).
- DATA-01 waits for PC-01 merge.
- API-02 waits for API-01 merge.
- GOV-01 stays queued this round.
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
- do not start DATA-01, GOV-01, API-02, COLLAB, SCI, INT or AUTO from this hand-off;
- do not merge #40 or #41 unless explicitly instructed;
- do not substitute models other than Medium or Low;
- do not broaden PLAT-03 into Medium security architecture in a Low worker;
- do not build DATA-01 inside PC-02;
- do not make `viewer` read-only inside PC-02;
- do not build a visual Pipeline designer or an AI-specific data/permission model;
- do not reopen FieldDefinition, Dataset, Definition/Instance, Template version or frozen-evidence architecture without a real defect;
- do not create another Dataset, Sheet, Template or capability system;
- do not treat the browser as the only future client.

## Expected hand-off from Ready streams

- **PC-02:** users can create and manage Datasets and Records without a Notebook as the only entry point; existing Core RPCs; no import framework; `viewer` unchanged.
- **PLAT-03 headers:** security headers present and tested; remaining hardening queued if it exceeds Low.
