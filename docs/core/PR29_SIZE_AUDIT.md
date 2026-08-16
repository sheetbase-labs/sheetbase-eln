# PR #29 size audit

**Status:** analysis only. No production behaviour was changed. This document was not used to rewrite history, merge, push, or update the GitHub PR body.

**PR:** [phlohouse/sheetbase-eln#29](https://github.com/phlohouse/sheetbase-eln/pull/29)  
**Range measured:** `origin/main...HEAD` (GitHub three-dot / merge-base comparison)  
**Head:** `6604e62c84ea27c1b0338f76af9eaad760a5e18e` (`agent/core-programme`, Core Hardening H1–H5)  
**Base tip:** `b8ce2e169fd9c3b534c107131695356d55c86105` (`main`, preview-deployment removal)  
**Merge-base:** `f682e1d341406c78c4a409bc72023823cd96d7c1` (`feat: add Cloud Agent development environment (#30)`)  
**Measured at:** 16 August 2026

GitHub’s summary (**409 files, +254,632 / −16,825, 100 commits**) matches `git diff --numstat origin/main...HEAD` exactly. The figures below are not estimates of that total.

---

## 1. Executive conclusion

PR #29 is large because **Drizzle Kit writes a full-database JSON snapshot on each `generate`**, and this branch added **twelve new snapshots** plus a journal update. Those JSON files are **+198,690 lines (78.03% of all additions)**. They mostly **restate the entire schema**, including tables that already existed before CORE-01. Consecutive snapshots differ by tens of unique lines, not tens of thousands.

The remaining **~55.5k additions (21.8%)** are real Core programme work: authored SQL, TypeScript, tests, seeds, and docs for CORE-01 through CORE-06 plus Core Hardening.

**Meaningful production-code change** (application `src/` excluding tests/stories/generated/seeds/ReUI formatting, plus authored `drizzle/*.sql`, plus small config/scripts) is about **+23.3k / −3.6k**, not +254k.

The huge GitHub number is **mostly legitimate generated migration metadata**, not accidental binary dumps or lockfile explosions. It **materially overstates semantic change**. It is **not** caused by `main` having moved on (one unrelated commit, preview deployments). Rebasing onto current `main` would **not** shrink the 254k figure.

The GitHub PR description is **stale**: it still describes CORE-01–03 and migration `0090`, while the branch contains CORE-01–06, Core Hardening, migrations through `0109`, and the current product-consolidation handoff.

---

## 2. Total diff statistics

| Metric | GitHub PR #29 | `origin/main...HEAD` (three-dot) | `origin/main HEAD` (two-dot tree diff) |
| --- | ---: | ---: | ---: |
| Files | 409 | 409 | 429 |
| Additions | 254,632 | 254,632 | 256,068 |
| Deletions | 16,825 | 16,825 | 16,878 |
| Net | 237,807 | 237,807 | 239,190 |
| Commits on branch not in `main` | 100 | 100 | — |
| Commits on `main` not in branch | 1 | 1 | — |

Name-status (`-M` / `-C` at 50% and 20%): **220 added, 169 modified, 20 deleted, 0 renames, 0 copies**.

Binary files in the numstat: **0**. Lockfiles in the diff: **none**.

Whitespace-only (`git diff -w`): additions 254,215 vs 254,632 (**417** whitespace-attributed adds); deletions 16,408 vs 16,825. CRLF ignore: 254,608 / 16,801. Line-ending and pure whitespace churn are **not** the story.

---

## 3. Breakdown by directory

Top-level paths in the three-dot diff:

| Directory / file | Files | Additions | Deletions | Net | % of additions | Classification |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `drizzle/` | 64 | 210,095 | 3 | 210,092 | 82.51% | KEEP / KEEP BUT GENERATED |
| `src/` | 227 | 20,146 | 9,373 | 10,773 | 7.91% | KEEP (subset REVIEW) |
| `tests/` | 58 | 13,777 | 5,972 | 7,805 | 5.41% | KEEP |
| `docs/` | 42 | 9,213 | 9 | 9,204 | 3.62% | KEEP (references REVIEW) |
| `scripts/` | 13 | 1,246 | 110 | 1,136 | 0.49% | KEEP (screenshots REVIEW) |
| `ROADMAP.md` | 1 | 84 | 116 | −32 | 0.03% | KEEP |
| `README.md` | 1 | 51 | 54 | −3 | 0.02% | KEEP |
| `.agents/setup` | 1 | 13 | 0 | 13 | 0.01% | KEEP |
| `vite.config.ts` | 1 | 7 | 1 | 6 | 0.00% | KEEP |
| `TODO.md` | 1 | 0 | 1,187 | −1,187 | 0.00% | KEEP (deletion) |
| **Total** | **409** | **254,632** | **16,825** | **237,807** | **100%** | |

Second-level concentration:

| Path | Files | Additions | % of additions | Classification |
| --- | ---: | ---: | ---: | --- |
| `drizzle/meta/` | 14 | 199,040 | 78.17% | KEEP BUT GENERATED |
| `tests/db/` | 42 | 11,939 | 4.69% | KEEP |
| `src/lib/` | 97 | 10,940 | 4.30% | KEEP |
| `docs/core/` | 22 | 7,645 | 3.00% | KEEP |
| `src/components/` | 86 | 5,260 | 2.07% | KEEP / REVIEW (ReUI) |
| `src/db/` | 5 | 2,470 | 0.97% | KEEP |
| remaining `drizzle/*.sql` | 50 | 11,055 | 4.34% | KEEP |
| `src/routes/` | 25 | 953 | 0.37% | KEEP (includes large deletion) |
| `docs/decisions/` | 9 | 945 | 0.37% | KEEP |
| `docs/references/` | 8 | 578 | 0.23% | REVIEW |
| everything else | — | — | — | see later sections |

---

## 4. Breakdown by file type

| Extension | Files | Additions | Deletions | Net | % of additions | Classification |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `.json` | 14 | 199,040 | 3 | 199,037 | 78.17% | KEEP BUT GENERATED |
| `.ts` | 171 | 28,176 | 8,296 | 19,880 | 11.07% | KEEP |
| `.sql` | 50 | 11,055 | 0 | 11,055 | 4.34% | KEEP |
| `.md` | 45 | 9,348 | 1,366 | 7,982 | 3.67% | KEEP / REVIEW |
| `.tsx` | 118 | 6,643 | 7,050 | −407 | 2.61% | KEEP / REVIEW |
| `.mjs` | 10 | 357 | 110 | 247 | 0.14% | REVIEW (mostly screenshot/verify scripts) |
| `(none)` `.agents/setup` | 1 | 13 | 0 | 13 | 0.01% | KEEP |

`.json` is entirely `drizzle/meta/` (twelve new snapshots, one journal, one tiny `0023_snapshot.json` id rewrite). There is **no** large application JSON fixture and **no** lockfile.

`.tsx` net is negative because Core Hardening **deletes** `src/routes/schemas.tsx` (−2,656).

---

## 5. Generated vs hand-written breakdown

| Kind | Files | Additions | Deletions | Net | % of additions | Classification |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Generated / machine-maintained | 15 | 199,103 | 24 | 199,079 | 78.19% | KEEP BUT GENERATED |
| Hand-written (all remaining) | 394 | 55,529 | 16,801 | 38,728 | 21.81% | mixed KEEP / REVIEW |

Generated members:

| Path class | Files | Additions | Deletions | Classification |
| --- | ---: | ---: | ---: | --- |
| `drizzle/meta/*_snapshot.json` | 13 | 198,690 | 3 | KEEP BUT GENERATED |
| `drizzle/meta/_journal.json` | 1 | 350 | 0 | KEEP BUT GENERATED |
| `src/routeTree.gen.ts` | 1 | 63 | 21 | KEEP BUT GENERATED |
| Lockfiles | 0 | 0 | 0 | n/a |
| Test snapshots (`*.snap`) | 0 | 0 | 0 | n/a |

`drizzle/*.sql` is **not** counted as generated here. Some files have drizzle-kit fantasy names (`shallow_energizer`, `nebulous_proudstar`, …) because Kit emitted them; they are still **durable, applied migration history** and must be kept.

The repository already tracks `src/routeTree.gen.ts` (AGENTS.md: committed, not regenerated in CI). That policy is unchanged and the delta is tiny.

**Do not untrack `drizzle/meta/` to make the PR smaller.** Kit uses snapshot `id` / `prevId` chaining. This repo already has sparse snapshots (gaps before CORE), but the new files are the generate artefacts for 0060–0087.

---

## 6. Top 30 largest files (by additions)

| # | Path | + | − | Classification | Expected? | Remain in #29? | Generated? | Suspicious churn? |
| ---: | --- | ---: | ---: | --- | --- | --- | --- | --- |
| 1 | `drizzle/meta/0087_snapshot.json` | 17,771 | 0 | KEEP BUT GENERATED | Yes | Yes | Yes | No (full-schema restatement) |
| 2 | `drizzle/meta/0082_snapshot.json` | 17,585 | 0 | KEEP BUT GENERATED | Yes | Yes | Yes | No |
| 3 | `drizzle/meta/0079_snapshot.json` | 17,210 | 0 | KEEP BUT GENERATED | Yes | Yes | Yes | No |
| 4 | `drizzle/meta/0073_snapshot.json` | 17,034 | 0 | KEEP BUT GENERATED | Yes | Yes | Yes | No |
| 5 | `drizzle/meta/0071_snapshot.json` | 16,786 | 0 | KEEP BUT GENERATED | Yes | Yes | Yes | No |
| 6 | `drizzle/meta/0066_snapshot.json` | 16,386 | 0 | KEEP BUT GENERATED | Yes | Yes | Yes | No |
| 7 | `drizzle/meta/0070_snapshot.json` | 16,386 | 0 | KEEP BUT GENERATED | Yes | Yes | Yes | **Duplicate of 0066 aside from ids** — still required for Kit’s chain |
| 8 | `drizzle/meta/0065_snapshot.json` | 16,344 | 0 | KEEP BUT GENERATED | Yes | Yes | Yes | No |
| 9 | `drizzle/meta/0064_snapshot.json` | 16,203 | 0 | KEEP BUT GENERATED | Yes | Yes | Yes | No |
| 10 | `drizzle/meta/0063_snapshot.json` | 15,925 | 0 | KEEP BUT GENERATED | Yes | Yes | Yes | No |
| 11 | `drizzle/meta/0062_snapshot.json` | 15,750 | 0 | KEEP BUT GENERATED | Yes | Yes | Yes | No |
| 12 | `drizzle/meta/0060_snapshot.json` | 15,307 | 0 | KEEP BUT GENERATED | Yes | Yes | Yes | No — first snapshot after `0023`; restates pre-CORE schema too |
| 13 | `tests/db/datasets.test.ts` | 1,480 | 0 | KEEP | Yes (CORE-02) | Yes | No | No |
| 14 | `src/db/seed/month.ts` | 1,259 | 460 | KEEP | Yes (seed rewrite) | Yes | No | Large but purposeful |
| 15 | `drizzle/0094_core_052_capabilities.sql` | 1,241 | 0 | KEEP | Yes (CORE-05) | Yes | SQL history | No |
| 16 | `tests/db/sheet-composition.test.ts` | 1,158 | 0 | KEEP | Yes (CORE-03) | Yes | No | No |
| 17 | `src/db/schema.ts` | 883 | 2 | KEEP | Yes | Yes | No | No |
| 18 | `drizzle/0097_core_05_idempotency_draft_publish.sql` | 818 | 0 | KEEP | Yes | Yes | SQL history | No |
| 19 | `docs/core/audits/RECORD_SHEET_ACTIONS_AUDIT.md` | 811 | 0 | KEEP | Yes (CORE-04 evidence) | Yes | No | No |
| 20 | `docs/core/audits/NOTEBOOK_EVIDENCE_AUDIT.md` | 796 | 0 | KEEP | Yes (CORE-06 evidence) | Yes | No | No |
| 21 | `tests/db/parameter-resolution.test.ts` | 782 | 0 | KEEP | Yes | Yes | No | No |
| 22 | `scripts/benchmark-dataset-query.ts` | 767 | 0 | KEEP | Yes (CORE-02 gate) | Yes | No | No |
| 23 | `tests/db/sheet-instances.test.ts` | 740 | 0 | KEEP | Yes | Yes | No | No |
| 24 | `src/lib/sheet-definition.ts` | 721 | 0 | KEEP | Yes | Yes | No | No |
| 25 | `docs/core/CORE_01_06_IMPLEMENTATION_REVIEW.md` | 705 | 0 | KEEP | Yes (handoff) | Yes | No | No |
| 26 | `docs/core/tasks/CORE-03.md` | 699 | 0 | KEEP | Yes | Yes | No | No |
| 27 | `src/components/configuration/configuration-workspace.tsx` | 663 | 0 | KEEP | Yes (CORE-05 UI) | Yes | No | No |
| 28 | `tests/db/sheet-calculations.test.ts` | 652 | 0 | KEEP | Yes | Yes | No | No |
| 29 | `drizzle/0100_core_065_template_instantiate.sql` | 630 | 0 | KEEP | Yes (CORE-06) | Yes | SQL history | No |
| 30 | `tests/db/sheet-definition-upgrade.test.ts` | 610 | 0 | KEEP | Yes | Yes | No | No |

The twelve snapshot files alone are **+198,687 net** — **78.0% of PR additions**. File #13 is the first hand-written file in the list.

---

## 7. Production-code-only estimate

Requested split of the full +254,632:

| Bucket | Files | Additions | Deletions | Net | % of additions |
| --- | ---: | ---: | ---: | ---: | ---: |
| `src/` (entire tree) | 227 | 20,146 | 9,373 | 10,773 | 7.91% |
| `drizzle/` (entire tree) | 64 | 210,095 | 3 | 210,092 | 82.51% |
| `tests/` | 58 | 13,777 | 5,972 | 7,805 | 5.41% |
| `docs/` | 42 | 9,213 | 9 | 9,204 | 3.62% |
| `scripts/` | 13 | 1,246 | 110 | 1,136 | 0.49% |
| Configuration / root (`vite.config.ts`, `.agents/setup`, `README.md`, `ROADMAP.md`, `TODO.md`) | 5 | 155 | 1,358 | −1,203 | 0.06% |
| Everything else | 0 | 0 | 0 | 0 | 0% |

`src/` internally:

| `src/` subset | Files | Additions | Deletions | Net | % of PR additions | Classification |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Production application code (not tests/stories/seeds/generated/ReUI) | 117 | 11,413 | 3,625 | 7,788 | 4.48% | KEEP |
| Colocated `*.test.ts(x)` | 69 | 4,537 | 2,505 | 2,032 | 1.78% | KEEP |
| `src/db/seed/` | 4 | 1,587 | 1,089 | 498 | 0.62% | KEEP |
| `src/components/reui/**` (Prettier / quote / wrapping) | 23 | 2,086 | 2,070 | 16 | 0.82% | REVIEW |
| `src/stories/` | 13 | 460 | 63 | 397 | 0.18% | REVIEW |
| `src/routeTree.gen.ts` | 1 | 63 | 21 | 42 | 0.02% | KEEP BUT GENERATED |

`drizzle/` internally:

| `drizzle/` subset | Files | Additions | Deletions | Net | % of PR additions | Classification |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Authored / Kit-emitted SQL migrations `0060`–`0109` | 50 | 11,055 | 0 | 11,055 | 4.34% | KEEP |
| Schema snapshots | 13 | 198,690 | 3 | 198,687 | 78.03% | KEEP BUT GENERATED |
| `_journal.json` | 1 | 350 | 0 | 350 | 0.14% | KEEP BUT GENERATED |

### If generated material, docs, tests, and fixtures are ignored

Counted as production for this question:

- production `src/` excluding tests, stories, seeds, `routeTree.gen.ts`, and ReUI formatting
- authored `drizzle/*.sql`
- `scripts/` that are not screenshot/verify/test helpers (`benchmark-dataset-query.ts`, `dataset-benchmark-safety.ts`, `start-prod.mjs`, `sign-cookie.mjs`)
- `vite.config.ts`, `.agents/setup`

| | Files | Additions | Deletions | Net |
| --- | ---: | ---: | ---: | ---: |
| **Production-code change** | **173** | **23,319** | **3,629** | **19,690** |

That is **9.2% of GitHub’s added-line count**.

Including ReUI formatting as “it is still `src/`” would add +2,086 / −2,070 with almost no semantic net. Including seeds would add +1,587 / −1,089.

**Answer:** ignoring generated metadata, docs, tests, and fixtures, the actual product/schema implementation is on the order of **+23k / −3.6k lines**, plus **+11k of that as SQL** and **+11k as TypeScript**.

---

## 8. Migrations / generated metadata analysis

### Authored SQL (`KEEP`)

- **50** new files under `drizzle/`, **+11,055** lines, **0** deletions.
- Journal on `main` ended at `0059_report_identity` (60 entries). This branch journals through **`0109_remove_legacy_compatibility`** (**110** entries).
- Duplicate number: **two `0079_*.sql` files** (`0079_core_038_prepare_generated_schema.sql` and `0079_nebulous_proudstar.sql`). Both are journaled. There is **no `0080_*.sql`**. This is awkward but already applied history — **do not delete** to tidy numbering.
- Fantasy-named Kit files (`0062_shallow_energizer.sql`, …, `0087_sharp_angel.sql`) are small table/constraint diffs. Custom `core_*` SQL holds RPCs and guards.

Largest SQL files:

| File | Lines added | Epic |
| --- | ---: | --- |
| `0094_core_052_capabilities.sql` | 1,241 | CORE-05 |
| `0097_core_05_idempotency_draft_publish.sql` | 818 | CORE-05 |
| `0100_core_065_template_instantiate.sql` | 630 | CORE-06 |
| `0099_core_063_notebook_template_versions.sql` | 605 | CORE-06 |
| `0096_core_055_evolution_promotion.sql` | 579 | CORE-05 |

### Snapshots (`KEEP BUT GENERATED`)

New snapshots exist only for: **0060, 0062, 0063, 0064, 0065, 0066, 0070, 0071, 0073, 0079, 0082, 0087**. Custom SQL-only migrations (0061, 0067–0069, 0072, 0074–0078, 0081, 0083–0086, 0088–0109) have **no** snapshot, matching the pre-CORE pattern (no snapshots for 0024–0059).

`0060_snapshot.json` is **15,307 lines** because Kit dumps **the whole database** (80 tables), not a CORE-only delta. `0023_snapshot.json` on `main` was 3,719 lines; everything added in 0024–0059 was never snapshotted until 0060 restated it.

Content-hash of snapshots with `id`/`prevId` removed:

- **0066 and 0070 are identical.** 0070 still adds **+16,386** on GitHub.
- Consecutive unique-line deltas are typically **8–84 lines**, while GitHub records **~16–18k additions each**.

`0023_snapshot.json` itself: **+3 / −3** (id/prevId rewrite + newline). Classification: KEEP BUT GENERATED.

GitHub therefore **overstates snapshot semantics by roughly an order of magnitude**: ~199k added lines vs a few thousand unique table/column lines of new schema.

### Should snapshots be regenerated instead of tracked?

**No for merge of #29.** `drizzle.config.ts` emits to `./drizzle`. This project already commits Kit metadata. Untracking mid-programme would break `pnpm db:generate` chaining and is not a size fix. A later policy (fewer generates, or accepting sparse snapshots as today) is a separate decision.

---

## 9. Tests / fixtures analysis

| Bucket | Files | Additions | Deletions | Net | % of additions | Classification |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `tests/db/` | 42 | 11,939 | 5,055 | 6,884 | 4.69% | KEEP |
| `tests/api/` | 9 | 700 | 835 | −135 | 0.27% | KEEP |
| `tests/browser/` | 3 | 109 | 82 | 27 | 0.04% | KEEP |
| `tests/fixtures/sheet-definition.ts` | 1 | 417 | 0 | 417 | 0.16% | KEEP |
| Other `tests/*.ts` (unit, definition parsers) | 3 | 612 | 0 | 612 | 0.24% | KEEP |
| Colocated `src/**/*.test.ts(x)` | 69 | 4,537 | 2,505 | 2,032 | 1.78% | KEEP |
| `scripts/dataset-benchmark-safety.test.ts` | 1 | 65 | 0 | 65 | 0.03% | KEEP |
| **All test-like files** | **128** | **18,379** | **8,477** | **9,902** | **7.22%** | KEEP |

Deletions include Core Hardening removal of legacy scientific-table / SCI-010 tests (`scientific-tables`, `scientific-rest`, `phase4-proof`, `chart-blocks`, `sheet-block`, `scientific-workbook.test.ts`, etc.). Those deletions are **product-intentional**, not accidental churn.

No Vitest/Playwright snapshot files appear in the diff.

Seeds (not tests, but fixtures):

| File | + | − | Notes | Classification |
| --- | ---: | ---: | --- | --- |
| `src/db/seed/month.ts` | 1,259 | 460 | Month-scale seed rewritten for Core objects | KEEP |
| `src/db/seed/run.ts` | 18 | 626 | Logic moved / slimmed | KEEP |
| `src/db/seed/sheet-instance-demo.ts` | 307 | 0 | New demo instances | KEEP |
| `src/db/seed/identities.ts` | 3 | 3 | Trivial | KEEP |

---

## 10. Docs / references analysis

| Bucket | Files | Additions | Deletions | Net | % of additions | Classification |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `docs/core/audits/` | 7 | 3,085 | 0 | 3,085 | 1.21% | KEEP |
| `docs/core/tasks/` | 8 | 2,548 | 0 | 2,548 | 1.00% | KEEP |
| `docs/core/` root (`PRODUCT_CORE`, architecture, NEXT, hardening, review, …) | 7 | 2,012 | 0 | 2,012 | 0.79% | KEEP |
| `docs/decisions/` ADRs 0020–0026, 0037–0038 | 9 | 945 | 0 | 945 | 0.37% | KEEP |
| `docs/references/eln-competitors/` | 8 | 578 | 0 | 578 | 0.23% | REVIEW |
| `README.md` / `ROADMAP.md` / other docs | 4 | 157 | 187 | −30 | 0.06% | KEEP |
| `docs/archive/README.md` | 1 | 32 | 0 | 32 | 0.01% | KEEP |
| `TODO.md` deleted | 1 | 0 | 1,187 | −1,187 | 0.00% | KEEP |

Historical planning: root `TODO.md` was **deleted**, not copied into `docs/archive/`. The archive README points at commit `0f252bc` on GitHub. GitHub therefore shows **−1,187** without a matching +1,187 copy. That is the correct archive strategy and **does not inflate additions**.

Competitor notes are hand-written research (Benchling, Dotmatics, Signals, SciNote, Labguru, Sapio, patterns). They are small relative to snapshots. They are **not runtime**. Classification **REVIEW**: keep in the programme tree if desired, or split later; **do not treat as the reason the PR is 254k**.

---

## 11. Rename / formatting / line-ending churn

| Hypothesis | Result |
| --- | --- |
| Delete + recreate of the same path | 20 deletes are real removals (legacy tests, `schemas.tsx`, `TODO.md`), not recreates of the same files. |
| Moves/renames GitHub missed | `git diff -M20%` / `-C`: **0 renames, 0 copies**. |
| Formatting-only | ReUI calendar/gantt: **23 files, +2,086 / −2,070**. Diffs are quote style (`"` → `'`), import wrapping, trailing commas. Semantic net **+16**. GitHub counts almost every line. |
| Line endings | CRLF-ignored diff almost identical to raw. `0023_snapshot.json` only adds a final newline. |
| Generated files fully rewritten | Snapshots are new files (except `0023`). Each new snapshot is a full rewrite of the schema JSON, which is how Kit works. |
| Archive by copy | `TODO.md` was **not** copied; only a 32-line pointer was added. |
| Large references introduced | Competitor markdown: **+578** only. |
| Branch divergence vs `main` | See §12. **Does not explain 254k.** |

GitHub **overstates** in two structural ways:

1. **Snapshot restatement** (~199k adds for a few thousand unique schema lines).
2. **Prettier on ReUI** (~2k adds and ~2k deletes for quote wrapping).

There is no lockfile rewrite, no `Concepts/` mockup import, no PNG-as-text, and no `package-lock` / `pnpm-lock` delta.

---

## 12. Main-branch divergence

| Ref | SHA | Note |
| --- | --- | --- |
| `origin/main` | `b8ce2e1` | `chore: remove PR-specific preview deployments (#31)` |
| `origin/agent/core-programme` / `HEAD` | `6604e62` | Core Hardening |
| Merge-base | `f682e1d` | Cloud Agent environment (#30), **parent of both** |

`main` is **1 commit ahead** of the merge-base; the PR branch is **100 commits ahead**.

`#31` touches preview compose/workflow/docs and `src/lib/preview-deployment.ts` (~21 files, +70 / −1,453). Those paths are **still present on `agent/core-programme`**. They **do not appear** in GitHub’s three-dot PR diff (three-dot ignores `main`-only changes). They **do** appear in a two-dot `main` vs branch tree diff (429 files, +256,068), which is why two-dot is slightly *larger*.

**Rebasing or merging current `main` into `agent/core-programme` would not materially reduce the +254k figure.** It would fold preview-deployment *deletions* into the branch so a future merge to `main` is cleaner, and it would avoid resurrecting preview files. That is integration hygiene, not a size fix.

PR #29 `mergeable` is `MERGEABLE` at audit time. The description still claims CORE-01–03 and `0090_core_0315_sheet_reuse_lifecycle` as the migration tip.

---

## 13. Suspicious or unnecessary files

Flagged for **later** cleanup discussion. Nothing below was deleted in this audit.

| Item | Why it looks odd | Recommendation class |
| --- | --- | --- |
| Twelve full Kit snapshots | Dominate GitHub LOC; 0066≡0070 | KEEP BUT GENERATED |
| Dual `0079_*.sql` / missing `0080` | Number collision | KEEP (history); REVIEW only as a comment in a follow-up |
| `src/components/reui/**` Prettier | Unrelated to CORE-01–06 behaviour | REVIEW — revert before merge if the goal is a reviewable diff |
| `scripts/screenshot-*.mjs`, `verify-schema-create.mjs`, `verify-schema-create2.mjs` | Formatting / duplicate verify script | REVIEW — `create2` looks redundant |
| `docs/references/eln-competitors/` | Copied research, not product code | REVIEW — keep or split; not size-critical |
| `src/stories/**` | Mixed formatting and CORE-06 copy | REVIEW |
| `vite.config.ts` `trycloudflare.com` | Cloud-agent tunnel host | KEEP (tiny; operational) |
| Deleted legacy tests / `schemas.tsx` | Large deletions | KEEP — Core Hardening |
| `TODO.md` deletion | Historical | KEEP |
| Amp-thread footers in older commit messages | Agent provenance in git log | Not a file; ignore for size |
| `Concepts/`, binaries, lockfiles, `.amp/`, tmp | Not in the PR | n/a |

Nothing looks like debug dumps, accidentally committed `node_modules`, or secrets.

---

## 14. Files/categories definitely safe to keep

| Category | Classification |
| --- | --- |
| Authored SQL `0060`–`0109` and journal entries | KEEP |
| Kit snapshots and `_journal.json` | KEEP BUT GENERATED |
| `src/db/schema.ts` and Core `src/lib/sheet-*`, `field-*`, `notebook-template*`, dataset, capability, record-write-back modules | KEEP |
| Core UI: notebooks, composed/ad-hoc sheets, configuration workspace, templates | KEEP |
| DB/API/browser tests and `tests/fixtures/sheet-definition.ts` | KEEP |
| Seeds (`month.ts`, `sheet-instance-demo.ts`) | KEEP |
| `docs/core/**`, ADRs 0020–0026 / 0037–0038 | KEEP |
| `scripts/benchmark-dataset-query.ts` and safety helper | KEEP |
| `src/routeTree.gen.ts` | KEEP BUT GENERATED |
| Intentional deletions of SCI-010 / scientific-table / `schemas.tsx` / obsolete tests | KEEP |

---

## 15. Files/categories to consider removing or regenerating

| Category | Classification | Notes |
| --- | --- | --- |
| ReUI Prettier-only edits | REVIEW / consider revert | Shrinks GitHub noise by ~2k/+2k, **not** 254k |
| Duplicate verify screenshot scripts | REVIEW | Tiny |
| Competitor reference markdown | REVIEW | Optional split; +578 lines |
| Storybook formatting | REVIEW | Optional revert of non-CORE stories |
| Snapshots | KEEP BUT GENERATED | **Do not remove** to slim the PR |
| Regeneration instead of tracking snapshots | REGENERATE INSTEAD OF TRACKING — **rejected for this merge** | Would fight Kit and repo policy |

---

## 16. Recommended cleanup before merge

Do these **after** this audit, not in this commit:

1. **Update the PR description** to CORE-01–06 + Core Hardening, migrations **0060–0109**, and the current `docs/core/NEXT.md` handoff. The body still stops at CORE-03 / `0090`.
2. **Merge or rebase current `main`** so preview-deployment removal is not fought at merge time. This does **not** cut 254k lines.
3. **Optionally revert** `src/components/reui/**` (and unrelated Storybook/screenshot Prettier) to make the human review surface honest.
4. **Do not** drop snapshot JSON or squash migration history.
5. **Optionally** note the `0079` duplicate tag in the PR text so reviewers are not surprised; do not renumber applied migrations.
6. Review `scripts/verify-schema-create2.mjs` for redundancy (not a size issue).

No production behaviour should change for (1)–(3) and (5)–(6) except whatever `main` already did for previews.

---

## 17. Estimated PR size after sensible cleanup

| Scenario | Approx. files | Approx. additions | Approx. deletions | Notes |
| --- | ---: | ---: | ---: | --- |
| **Current GitHub #29** | 409 | 254,632 | 16,825 | Measured |
| Revert ReUI Prettier | ~386 | ~252,500 | ~14,800 | Cosmetic |
| Also drop competitor refs (not recommended as required) | ~378 | ~252,000 | ~14,800 | Still snapshot-dominated |
| Also revert unrelated stories/screenshot formatting | ~360 | ~251,000 | ~14,600 | Still snapshot-dominated |
| **Review as if snapshots were collapsed to “generated, skip”** | ~395 | **~55,500** | **~16,800** | Honest human-review size |
| Production-only (this audit’s definition) | 173 | **~23,300** | **~3,600** | Implementation size |

**Sensible cleanup does not make this a small PR.** After dropping obvious formatting and optional docs, reviewers should still expect **~250k GitHub additions**, of which **~199k are Kit snapshots they can skip**, leaving **~56k hand-written lines** (docs + tests + SQL + TS) and **~23k production TS+SQL**.

---

## Appendix A — How this was measured

```text
git fetch origin main agent/core-programme
git diff --shortstat origin/main...HEAD
git diff --numstat origin/main...HEAD
git diff --name-status -M -C origin/main...HEAD
git diff -w --numstat origin/main...HEAD
git rev-list --left-right --count origin/main...HEAD
```

Snapshot uniqueness: SHA-256 of each `drizzle/meta/*_snapshot.json` after stripping `id` and `prevId`. 0066 and 0070 matched.

PR metadata: `gh pr view 29 --repo phlohouse/sheetbase-eln`.

---

## Appendix B — Stale PR description (do not update yet)

Current GitHub body still states:

- Completes the programme **through CORE-03**
- Verification through **`0090_core_0315_sheet_reuse_lifecycle`**
- Handoff to **CORE-04.1**

`agent/core-programme` at `6604e62` actually contains CORE-01–06, Core Hardening H1–H5, SQL through **0109**, and product-consolidation / NEXT.md pointing past CORE-06. Description refresh is deferred until after this size audit, as requested.
