# Programme map and status

**All 21 tasks are implemented** on `GWP/roadmap-5-implementation` (PR #222),
integrated in waves from separate worktrees, one commit per task. Implementation
is not acceptance: the corpus's success criteria are not yet recorded as met, and
the visual-parity and browser layers remain deferred. The audit baseline is ELN
`10a84a42`, 11 October 2026.

This is the only task-status table in this corpus. See [FINDINGS.md](FINDINGS.md)
for the audit each row comes from and [README.md](README.md) for the programme.

Effort is a coarse engineering estimate including targeted verification: S is up
to a day, M is roughly 2–4 days, L is roughly 5–10 days. These are not calendar
commitments. Risk means scientific meaning, evidence or access semantics — not a
demonstrated vulnerability.

| ID           | Outcome                                                                     | Class                          | Priority | Effort | Risk   | Depends on                       | Status          |
| ------------ | --------------------------------------------------------------------------- | ------------------------------ | -------- | ------ | ------ | -------------------------------- | --------------- |
| R5-SURF-01   | Dataset detail carries its Imports, Used by and History tabs                | New surface over existing data | P0       | L      | Low    | None                             | DONE `4394c797` |
| R5-SURF-02   | A project lists its own Datasets, Samples and Experiments                   | New surface over existing data | P0       | L      | Low    | None                             | DONE `9dec4194` |
| R5-SURF-03   | Unmatched URLs render the product's not-found screen                        | Fix                            | P0       | S      | Low    | None                             | DONE `0bac034b` |
| R5-SURF-04   | An import is addressable, resumable and can create a dataset                | Extension                      | P1       | M      | Medium | None                             | DONE `1d4a77f7` |
| R5-STUDIO-01 | Analyse mode states its method: ANOVA, assumptions, term table              | New                            | P1       | L      | High   | A statistics decision (see task) | DONE `43e7fc9e` |
| R5-STUDIO-02 | Chart encodings are authored by drag-and-drop shelf and role list           | Extension                      | P2       | M      | Low    | None                             | DONE `cb5d16b3` |
| R5-STUDIO-03 | Stale sources and citations are explicit and resolvable                     | Extension                      | P1       | M      | High   | Analysis frozen-source contract  | DONE `6b364416` |
| R5-NOTE-01   | Review presents the annotated document, not only a diff                     | New                            | P2       | L      | High   | Review round semantics           | DONE `2a5dcc8d` |
| R5-NOTE-02   | Notebook carries signature-request and action blocks, and one e-sign dialog | Extension                      | P2       | L      | High   | REV-03 signing contract          | DONE `3475b182` |
| R5-HOME-01   | A quiet home says what is next                                              | Extension                      | P2       | M      | Low    | None                             | DONE `869d20c0` |
| R5-CONFIG-01 | Diagnostics and usage carry their evidence                                  | Extension                      | P2       | M      | Low    | Usage metering decisions         | DONE `56e7dd55` |
| R5-CONFIG-02 | Instruments declare how data arrives and when it last did                   | Extension                      | P2       | M      | Medium | LAB-06 contracts                 | DONE `44d5ba6d` |
| R5-CONFIG-03 | Model versions can be submitted for approval and merged safely              | Extension                      | P1       | L      | High   | MDL-03 publication decision      | DONE `acef0a8a` |
| R5-CONFIG-04 | Template in-use and version history are inspectable                         | Extension                      | P2       | M      | Medium | SHEET-04 governance              | DONE `32cf55e6` |
| R5-CONFIG-05 | Milestones carry scale, dependencies, risk and date history                 | Extension                      | P2       | L      | Medium | PROJ-02 decisions                | DONE `60cb3629` |
| R5-SHELL-01  | Every product route gets the adopted shell                                  | Fix                            | P2       | M      | Low    | None                             | DONE `8f6c02a6` |
| R5-SHELL-02  | The theme is applied at first paint, not after it                           | Fix                            | P1       | S      | Medium | None                             | DONE `61627b2a` |
| R5-SHELL-03  | Capability flags have real keys and honest gap states                       | Fix                            | P1       | M      | Medium | None                             | DONE `b636a354` |
| R5-SHELL-04  | Search and pickers carry their designed scope and suggestions               | Extension                      | P2       | M      | Medium | SRCH-02 follow-on                | DONE `dc7387a6` |
| R5-SHELL-05  | Sign-in covers its designed states or records why not                       | Decision + fix                 | P2       | M      | High   | Authentication decision          | DONE `e8a15cd7` |
| R5-SHELL-06  | Pipeline code and artefact state are presented, not dumped                  | Extension                      | P3       | S      | Low    | None                             | DONE `347de309` |

## Delivery sequence

### Wave A — reach what already exists

SURF-01, SURF-02, SURF-03 and SHELL-03. These add no new domain capability: the
tables, the timeline component and the not-found screen are already in the
repository. Exit: a dataset shows its imports, usage and history; a project
lists its own datasets, samples and experiments; an unknown URL renders the
product's own screen; a deployment can name an unbuilt capability and the UI
says so.

### Wave B — the studio and the quiet home

STUDIO-01, STUDIO-02, STUDIO-03, HOME-01, SURF-04. Exit: an analysis states its
method and its inputs, resolves a stale source, and charts are authored without
form-filling; a workspace with nothing waiting reads like the design; an import
can be linked, resumed and aimed at a new dataset.

### Wave C — fidelity and configuration

NOTE-01, NOTE-02, CONFIG-01..05, SHELL-06. Exit: review reads as an annotated
document, the notebook carries signature and action blocks, and the
configuration surfaces carry the evidence the designs show.

### Wave D — platform decisions

SHELL-01, SHELL-02, SHELL-04, SHELL-05. These are sequenced last because two of
them need a decision (authentication states) or touch every route (theme at
first paint, shell coverage). Exit: one shell and one theme behaviour across the
product, with search and sign-in states matching their designs or a recorded
reason they differ.

## Ownership and non-duplication

- Where a requirement is already owned by a Roadmap 4 task or an accepted
  decision, the task file names it and this programme owns only the additional
  interface scope. Do not maintain a second completion checklist for the same
  behaviour.
- The interface source
  (`/Users/garethprice/Developer/sheetbase/sheetbase-app-ui-only`) is a design
  reference, not a dependency: nothing here adds it to the workspace or copies
  its fixture data.
- The unnumbered scientific-workflow proposal at
  `plans/roadmap-5/` is a separate programme. If it is activated, reconcile the
  two before either claims a shared outcome.

## Delivery record

Implemented 11 October 2026 on `GWP/roadmap-5-implementation` (PR #222), as 21
commits — one per task — integrated in three waves from separate git worktrees.
Commits per task are in the Status column above.

| Gate                                               | Result on the integrated branch                               |
| -------------------------------------------------- | ------------------------------------------------------------- |
| `tsc --noEmit`                                     | 0 errors                                                      |
| `eslint src scripts`                               | 0 errors (pre-existing warnings only)                         |
| Unit and component suite                           | **430 files / 4374 tests pass** (baseline `main`: 390 / 4044) |
| Database layer (new files plus the regression set) | **22 files / 192 tests pass**, serial                         |

Three things the integration had to resolve, recorded so the next programme
expects them:

- **Migration numbers collide under parallelism.** Four tasks each picked the
  next free number. Integration renumbered to a contiguous chain:
  `0422_dataset_list_summary_project`, `0423_search_archived_scope`,
  `0424_instrument_intake_method`, `0425_milestone_risk_read_model`,
  `0426_dataset_schema_expected_revision`,
  `0427_notebook_signature_action_blocks`, `0428_analysis_method_version`,
  `0429_studio_03_stale_citations`. Commit messages may name the agent's
  original number.
- **The database harness races on template rebuild.** Changing the journal makes
  every worker rebuild the template database; parallel workers then fail with
  `Cannot reach local PostgreSQL` or `Connection terminated unexpectedly`. Run
  database work with `--maxWorkers=1`, and fix the harness separately.
- **`tsr generate` drops the committed SSR registration block.** Three tasks ran
  it to register new routes; its output omits the `declare module
'@tanstack/react-start'` block that `main` carries, and the first such commit
  recorded that output verbatim. The branch needed a repair commit
  (`7e65eded route-tree`) to restore it. Regenerate, then re-add the block
  before committing; do not commit the generator's output verbatim.
- **A shipped feature must never default to a gap.** `R5-SHELL-03` registered
  two capability keys and gated the samples Measurements and experiments Results
  tabs behind them, off by default. Both surfaces ship in the product, so the
  default state claimed "not in this release yet" about features that are in it
  and hid them from every fresh deployment. The keys were removed and nothing is
  gated (`b636a354`); the mechanism stays, documented as the extension point for
  a capability a deployment genuinely lacks.
- **Shared files need one owner.** `src/routes/__root.tsx`, `src/router.tsx` and
  `src/routes/review/$revisionId.tsx` were each touched by two or three tasks.
  Integration resolved the overlaps; a future wave should assign those files up
  front.

**Not verified, and not claimed:** the visual-parity layer (DSYS-06 remains a
recorded gap) and the browser layer as a whole. Two browser checks were run by
their tasks — the one-shell assertions at 1024/390/1440 and the annotated-review
document at 390px — and are named in those commits. Acceptance of the corpus's
success criteria is a separate exercise from task completion.
