# Sheetbase roadmap

## Current shape

Roadmap 4 reconciled on 2 October 2026 at `roadmap-4/ui-app3`, `9bbd305c`.
Roadmaps 1–3 retain the 7 September historical baseline, with later ADR status
qualified below. See [Roadmap 4 evidence](roadmap-4/RECONCILIATION.md).

```text
Roadmap 1    RECORDED COMPLETE
Roadmap 2    ACTIVE SCOPE CLOSED; GOV-02 DEFERRED
Roadmap 3    WAVES A–C IMPLEMENTATION MERGED; ACCEPTANCE QUALIFIED
             WAVE D: HISTORICAL DEFERRALS; ADR-0045 NOW ACCEPTED
Roadmap 4    MERGED TO MAIN (10a84a42) — 85/85 ACTIVE TASKS DONE; 6 CANCELLED
Roadmap 5    PROPOSED — APP-3 INTERFACE CLOSURE (21 TASKS, NOT ACTIVATED)
             separate, unnumbered proposal: complete scientific workflows
```

Current priority and hand-off live in [`NEXT.md`](NEXT.md). The
[reconciliation record](history/2026-09-07-roadmap-reconciliation.md) separates
merged implementation, inherited completion claims, outstanding capabilities,
verification gaps and intentional deferrals. This is not a blanket release or
production-readiness sign-off.

## Destination

Sheetbase is a scientific data workspace where the Notebook provides scientific context and Excel-like Sheet Instances provide the primary structured-data interaction surface while PostgreSQL remains authoritative.

Reusable organisational configuration — Models, Dataset Schemas, Sheet Definitions, Notebook Templates and vocabularies — is separate from scientific working state — Records, Datasets, Notebooks and Sheet Instances.

A Sheet Instance can compose multiple Datasets and Model Records with local and calculated columns. Every value has provenance and every writable value has one authoritative write target.

## Roadmap 1 — Core Data Workspace

[`roadmap-1/`](roadmap-1/) is the completed Roadmap 1 corpus.

Recorded completed epics:

1. CORE-01 — Common Schema Kernel
2. CORE-02 — Dataset Primitive
3. CORE-03 — Compositional Sheet
4. CORE-04 — Records from Sheets
5. CORE-05 — Schema Evolution and Role-aware Configuration
6. CORE-06 — Notebook Integration and Frozen Evidence
7. Core Hardening

The Core programme established the canonical data model, reuse/version semantics, stable identities, Record creation from Sheets, role-aware configuration, Notebook integration, Dataset Versions and frozen evidence. Historical closure is retained; this reconciliation does not independently re-certify every Core exit.

## Roadmap 2 — Product & Platform Consolidation

[`roadmap-2/`](roadmap-2/) contains the Roadmap 2 programme corpus.

Roadmap 2's active scope is recorded closed. Its streams consolidated product,
data, collaboration, scientific analysis, integrations, platform, API,
governance, deterministic Pipelines, inspectable agent operations and bounded
agent workflows. [Task status](roadmap-2/tasks/README.md) now reflects that
closure rather than the superseded early-programme queue.

GOV-02 Organisation Model remains deliberately ADR-gated/deferred. Known limits
remain, including Sheet-cell/range comment anchors, bounded imports/analysis and
on-host recovery protection. Programme closure does not mean every possible
follow-up or later product requirement is implemented.

## Roadmap 3 — Product & Scientific Maturity

[`roadmap-3/`](roadmap-3/) contains **18 capability streams and 60 numbered tasks**.
It is no longer a planned/unstarted roadmap:

1. **Product Depth — 15:** NAV-01..03, GRID-01..05, NOTE-01..04, FIND-01..03 — implementation merged.
2. **Scientific Depth — 14:** KNOW-01..03, VIEW-01..04, MODEL-01..04, REUSE-01..03 — implementation merged; REUSE-02 has a historical baseline failure; equivalent current workflow acceptance remains unverified.
3. **Open Platform — 12:** SDK-01..03, EVENT-01..03, EXT-01..03, ADMIN-01..03 — implementation merged; release/publishing and deployment evidence remain separate claims.
4. **Intelligent Workspace — 9:** AI-01..03, ASSIST-01..03, AUTO-PLUS-01..03 — bounded implementation merged; the model gateway is stub-backed, not a live provider integration.
5. **Institutionalise — 10:** The September baseline recorded ENT-ORG-01 and GXP-01 proposed and ENT-ORG-02/03, GXP-02..04 and OPS-01..03 deferred. ADR-0045 was subsequently accepted through Roadmap 4 DEC-04; ADR-0044 remains proposed.

The September reconciliation recorded **50 tasks with merged implementation,
two proposals and eight deferrals**; the ADR-0045 update above supersedes its
old proposed status. This is not “60 tasks accepted complete”. The 50 includes limited
implementations and unresolved verification; see the
[task index](roadmap-3/tasks/README.md) and
[programme map](roadmap-3/PROGRAMME_MAP.md).

Governing principle:

> Mature Sheetbase for its own users. Make interoperability a property of the platform, not the reason for the roadmap.

## Roadmap 4 — design-led product

[Roadmap 4](roadmap-4/README.md) contains 17 streams and 86 original tasks. All
85 active tasks are done and **merged to `main` as `10a84a42`** (PR #220,
11 October 2026); SHELL-04 is cancelled in favour of DEC-03 and five further
steps are cancelled. [The 2 October reconciliation](roadmap-4/RECONCILIATION.md)
and its limits still stand: task completion is not release acceptance, and the
deferred visual and browser layers remain unverified. [roadmap-4/NEXT.md](roadmap-4/NEXT.md)
records the remaining acceptance gaps.

[NEXT.md](NEXT.md) owns cross-roadmap priority. [Roadmap 5](roadmap-5/README.md)
is the proposed follow-on corpus for app-3 interface closure; the unnumbered
[complete scientific workflows](../../plans/roadmap-5/README.md) proposal is a
separate programme and no longer owns the Roadmap 5 number.

## Roadmap 5 — app-3 interface closure

[`roadmap-5/`](roadmap-5/) is a **proposal**, not activated. It records what the
app-3 interface build (`sheetbase-app-ui-only`, an unversioned working copy) has
that the ELN does not, audited against `main` at `10a84a42` on 11 October 2026:
**21 proposed tasks across six streams** — reach what we hold, analysis studio
depth, notebook and review fidelity, home, configuration depth, and shell,
search and platform.

The findings are concrete and mostly cheap: `dataset_imports` is written and
indexed with no reader anywhere, the reusable `ObjectHistoryTimeline` is mounted
only for sheets, and the ported `NotFound` screen is wired to nothing. The
programme adds no architecture; it finishes the interface the ELN adopted.

Read [the findings](roadmap-5/FINDINGS.md) for the per-screen evidence (including
what is verified _not_ missing), [the programme map](roadmap-5/PROGRAMME_MAP.md)
for status and sequencing, and [the guide](roadmap-5/GUIDE.md) before taking a
task. This corpus keeps no separate task queue: the repository-wide
[NEXT.md](NEXT.md) decides activation.

## Golden workflow

Continue to use realistic scientific workflows, including the Lentivector purification example, as cross-roadmap proof. Passing component or database suites is not a substitute for a complete real-service workflow and frozen-evidence reconstruction.

## Delivery rules

- Build narrow end-to-end slices through DB/RLS/API/UI/tests.
- Stable semantic IDs back durable dependencies.
- PostgreSQL remains authoritative for permissions and durable scientific state.
- Audit history is not a substitute for immutable scientific versions/evidence.
- Shared Sheet Instances are explicit.
- Reuse uses composition, not hidden inheritance or accidental shared state.
- Exploratory local work remains legitimate; promotion into governed structure is explicit.
- The browser is one client of the domain; APIs/SDKs are first-class product surfaces.
- AI and Pipelines use ordinary permissions, validation and provenance rather than bypassing them.
- Add ADRs only for genuine durable architectural forks.
- During pre-release, remove superseded compatibility paths unless a current explicit dependency requires them.
- Distinguish implementation merged, acceptance verified, deployment observed and deferred scope in completion claims.
