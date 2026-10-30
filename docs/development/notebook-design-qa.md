# Notebook design and QA pilot

Status: assessment brief; workflow acceptance has not yet been executed.

This is the bounded first design/QA exercise, not a new roadmap or release
sign-off. [Current work](https://github.com/sheetbase-labs/sheetbase-eln/blob/main/docs/knowledge/NEXT.md) remains the priority authority.
Use [PRODUCT.md](https://github.com/sheetbase-labs/sheetbase-eln/blob/main/docs/knowledge/PRODUCT.md), [DESIGN.md](https://github.com/sheetbase-labs/sheetbase-eln/blob/main/docs/knowledge/DESIGN.md),
the [product-design skill](https://github.com/sheetbase-labs/sheetbase-eln/blob/main/.agent/design/skills/product-design/SKILL.md)
and Impeccable together. Record findings against actual rendered behaviour and
server contracts; historical mocks are discovery material, not acceptance proof.

## Design brief

- **User:** laboratory scientist recording and reviewing experimental work.
- **Job:** find an experiment, understand its context, capture narrative and
  structured results, save changes and return to the same scientific meaning.
- **Object:** Notebook and embedded Sheet Instance, with linked Records and
  Datasets where the specific fixture provides them.
- **Context:** local seeded ELN; start with Virus Stability at 4°C. Use a separate
  editable notebook for mutations; do not assume the submitted demo is editable.
- **Mode:** Impeccable Operate; Sheetbase Design Review initially, then Implement
  or Harden for an agreed correction.
- **Desired outcome:** a continuous scientific document with legible evidence,
  predictable controls and visible save, permission and review states.
- **Primary action:** edit and save narrative or a permitted Sheet value.
- **Consequence:** persist to the canonical notebook or the uniquely identified
  Sheet write target; never imply a local exploratory value is a Dataset update.
- **Success signal:** correct data survives reload; source identity, units and
  provenance remain inspectable; errors never appear as successful saves.
- **Non-goals:** replacing the visual identity, migrating every component,
  enabling a real AI provider, regulated-use certification or production changes.
- **Permissions:** verify both allowed and denied operations with real identities;
  the auth-free owner demo alone cannot establish isolation.
- **Reversibility:** use disposable fixtures. Offer undo only where implemented;
  preserve published definitions and frozen evidence semantics.
- **Reachable states:** loading, empty, populated, focus/selection, editing,
  saving, validation failure, connection failure, read-only and submitted/frozen.
  Verify whether conflict/unsaved states exist before promising their behaviour.
- **Open decisions:** agree concrete visual corrections after the first rendered
  review; confirm performance budgets after measurements; decide component adoption
  only after checking the integrated data contract.

## Review setup

Record the application SHA and dirty changes, design submodule SHA and dirty
changes, browser/version, OS/hardware, viewport, theme, seed and actor for each run.
Use local disposable data. Never include secrets, cookies or tokens in evidence.

Inspect desktop at 1440×900 and narrow layout at 390×844 in one batched pass;
include the user's actual viewport when it differs. Check keyboard-only use,
200% zoom and supported light/dark variants. Dense grids may scroll horizontally;
page chrome must not obscure the task or strand controls off-screen.

Batch corrections after that pass and confirm at most once. Functional failures
may receive targeted regression checks; do not restart whole visual reviews for
unrelated fixes.

## Acceptance matrix

All rows begin **untested**. Existing suites below are starting points to inspect,
not proof that these exits already pass.

| ID  | Scenario                                | Acceptance evidence                                                                                                                                                                                                        |
| --- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N01 | Find and open the seeded experiment     | Location, title, state and primary work are clear; keyboard navigation works; back/return preserves understandable context. Capture wide/narrow views.                                                                     |
| N02 | Instantiate a notebook template         | Required/default parameters are visible and validated; a new independent notebook is created; reopen preserves values. Reproduce the REUSE-02 default-value failure recorded in NEXT before claiming it resolved.          |
| N03 | Edit narrative and reorder blocks       | Correct content and order survive reload without duplicates; focus remains usable; resting blocks form one document.                                                                                                       |
| N04 | Edit local Sheet cells                  | Keyboard selection, paste and validation work; only intended cells change; values and units survive reload. The demo's local Sheet is not evidence for bound write-back.                                                   |
| N05 | Edit a bound/composed Sheet fixture     | A separate fixture proves each permitted change reaches its one canonical source row/field; joined/derived/read-only values cannot write to a guessed destination. Verify source data independently of the displayed cell. |
| N06 | Analyse and inspect scientific evidence | Independently calculated expected values match within a stated numerical tolerance; units, missing/invalid distinctions and source versions remain correct. Exports preserve labels and meaning.                           |
| N07 | Submit and reopen frozen evidence       | Record the frozen result, mutate a permitted live source, and reopen the submitted evidence: pinned values and interpretation are unchanged. Audit presence alone does not pass.                                           |
| N08 | Permission isolation                    | A second workspace and a restricted actor cannot read or mutate protected objects through direct server/API requests; UI states agree with server denial. Use real auth, not only the demo session.                        |
| N09 | Interrupted save and invalid input      | Inject a local request failure; no false saved state, silent loss or duplicate mutation occurs. Recovery/retry follows the implemented contract and communicates what was preserved.                                       |
| N10 | Accessibility and layout                | Controls have accessible names, visible focus and logical keyboard paths; dialogs restore focus; status is understandable without colour; zoom, long labels and narrow layouts retain access to work.                      |
| N11 | Populated recovery                      | Restore a backup into a separate local target and verify records, relationships, attachments and frozen evidence against a pre-backup manifest. Never restore over the working database.                                   |

Useful starting points:

- [Template component regression](https://github.com/sheetbase-labs/sheetbase-eln/blob/main/src/components/templates/versioned-notebook-templates.test.tsx)
- [Notebook authoring browser suite](https://github.com/sheetbase-labs/sheetbase-eln/blob/main/tests/browser/note-01-authoring.test.ts)
- [Grid keyboard browser suite](https://github.com/sheetbase-labs/sheetbase-eln/blob/main/tests/browser/grid-keyboard-selection.test.ts)
- [Virus Stability browser suite](https://github.com/sheetbase-labs/sheetbase-eln/blob/main/tests/browser/sci-009-virus-stability.test.ts)
- [Sheet/notebook benchmark](../../perf/sheet-notebook.ts)

## Performance protocol

Separate Vite cold compilation from product performance. Use a local production
build for comparable acceptance measurements, with the same data, browser and
hardware. Record errors alongside timings; a fast failed request never passes.

| Workload                                             | Measurement                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Seeded 32-row local Sheet                            | Time to usable grid, keyboard/edit response, paste and durable-save latency                      |
| Notebook with 50, 200 and 500 blocks                 | Navigation-to-usable time, request count, long tasks and scrolling behaviour                     |
| Bound Dataset with 10,000 rows, pages of 100 and 200 | Server query latency separately from browser hydration, selection/edit latency and memory growth |
| Long labels, missing values and boundary inputs      | Correctness and responsiveness without silent truncation or loss of scientific meaning           |

Use the existing benchmark's disposable workspace for scale fixtures. Inspect its
guards and side effects before running it. Do not imply a 10,000-row Dataset can
be imported through a parser with a lower documented limit.

For interactive timings collect five warm-ups and 30 measured repetitions;
record cold load separately. Report median, p95 and errors with raw samples.
Browser timings and server benchmark timings must remain separate.

Initial local investigation thresholds are 2 seconds to usable seeded notebook,
100 ms visible edit feedback and 1 second durable single-cell save (warm p95).
These are proposed pilot targets, not an existing SLA or measured capability.
Report scale curves at larger sizes before agreeing supported workload budgets.

## Findings and completion

For each result record ID, status (pass/fail/blocked/untested), fixture/actor,
expected versus observed behaviour, reproduction steps, evidence path and severity.
Classify capabilities separately as verified, partial, stubbed, deferred or
untested; an intentional limit is not automatically a regression.

Prioritise data loss, incorrect scientific results and isolation failures, then
blocked core workflows, then recurrent usability/consistency issues. Place fixes
in shared components/tokens when they recur; add prose rules only when judgement
cannot be enforced there.

The pilot is complete when each scoped row has a disposition and evidence,
agreed corrections have one confirmation pass, and remaining gaps are explicit.
Blocked or untested rows prevent blanket acceptance. Local readiness HTTP 200 and
successful seeding prove setup only; they do not pass this matrix.
