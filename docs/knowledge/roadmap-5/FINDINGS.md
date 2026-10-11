# Findings — app-3 interface gap audit

Audit of `/Users/garethprice/Developer/sheetbase/sheetbase-app-ui-only` against
`sheetbase-eln` `main` at `10a84a42`, 11 October 2026.

## Method and limits

- Route inventories were normalised (`_app/` stripped, `$param_` → `:id`,
  `index` collapsed) and diffed: 96 interface routes, 133 ELN routes, 80 with
  the same shape.
- Five read-only comparison passes covered: dataset and import routes;
  project-scoped routes; component areas; the 14 `docs/screens/*.md` designs;
  shell and platform behaviours.
- Every absence claim cites the searches that found nothing, so it can be
  re-checked when the code moves.
- **Limits.** The interface source is an unversioned working copy (no `.git`), so
  it cannot be pinned to a revision. The ELN half is pinned to `10a84a42`. The
  audit is a source and render comparison; it is not a browser acceptance run.
  The interface build's own `?state=` QA affordances were read as design intent,
  not as product requirements.

## Not gaps — verified, to stop the list growing

| Checked           | Result                                                                                                                                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Design primitives | All 28 files in the interface's `src/components/ui/` exist in `src/components/v3/ui/`; the ELN has one more (`confirm-dialog`).                                                                                         |
| Colour tokens     | All 50 names in `design/tokens.json` resolve somewhere in the ELN's `src` (CSS variables or class tokens).                                                                                                              |
| Phone behaviour   | Dialogs' `max-md:bottom-0` bottom-sheet rules, 44px targets (`max-md:h-10`, `min-h-11`), bottom tabs and the nav rail are byte-equivalent ports in `src/components/v3/ui/` and `src/components/v3/shell/app-shell.tsx`. |
| Command palette   | The ⌘K palette and the Command-based record picker both exist; the picker is a separate surface in both builds, not a palette group.                                                                                    |
| Bench flows       | `/scan` (with an extra jsQR fallback the design build lacks) and `/readings/new` are ports of the same routes with the same checks.                                                                                     |
| Inspector         | `src/components/v3/ui/layout.tsx` reproduces inline ≥1280 / side panel / bottom sheet exactly.                                                                                                                          |

## Gaps

Each row names the interface file, the ELN evidence (or the searches that found
nothing), and what is missing. Priorities and task owners are in
[PROGRAMME_MAP.md](PROGRAMME_MAP.md).

### 1. Dataset detail is missing four of its six tabs — `R5-SURF-01`

- Interface: `routes/_app/datasets/$datasetId.tsx:17,43-49` defines Rows,
  Snapshots, Columns, Imports, Used by, History.
- ELN: `src/routes/datasets/$datasetId.tsx:110-125` has Overview, Data,
  Snapshots, Compare only.
- **Imports:** `dataset_imports` is referenced **only** in `src/db/schema.ts`
  (table at `:4877`, index at `:4960`) — no reader exists anywhere in `src/`.
- **History:** `src/components/audit/object-history-timeline.tsx:229` is mounted
  only through `object-history-dialog.tsx:66` for sheets; no dataset surface
  mounts it, though datasets are a `change_events` entity type.
- **Used by:** no `used by`/`usedBy` match in `src/routes/datasets` or
  `src/components/v3/datasets`.
- **Columns:** the interface's own screen is a stub
  (`routes/_app/datasets/$datasetId/columns.tsx` renders a placeholder); column
  identity is already reachable through the Rows grid headers and the Model
  Fields tab. Reclassified: not missing, only unreachable as a tab.
- Also absent: a dataset `Download CSV` action and the Rows tab's `Analyse`
  action.

### 2. Project scoping stops at the Overview — `R5-SURF-02`

- Interface: `routes/_app/projects/$projectId.tsx:44-63` tabs Overview,
  Milestones, Experiments, Samples, Datasets, Files, Members, Settings, plus
  header actions (Members, New experiment) and per-tab counts.
- ELN: `src/routes/projects/$projectId.tsx:87-120` — Overview, Milestones,
  Folders, Members, Settings; no header actions, no counts.
- **Datasets:** no `projects/$projectId/datasets.tsx`, no
  `ProjectDatasets|project-datasets` match. Only the global registry and the
  per-model list exist.
- **Samples:** no `projects/$projectId/samples.tsx` and no project filter
  anywhere; project is a display-only field on a sample.
- **Experiments:** no route; the Overview shows the five most recent
  (`src/routes/projects/$projectId/index.tsx:161-224`) and the global list can
  group by project (`src/routes/experiments.tsx:77,184-193`) but cannot filter
  to one.

### 3. There is no branded not-found screen — `R5-SURF-03`

- Interface: `routes/_app/$.tsx` renders `components/shell/not-found.tsx`.
- ELN: `src/components/v3/shell/not-found.tsx:16` exists but is mounted nowhere
  (no `<NotFound` outside the file), there is no `$` route, and
  `src/router.tsx` sets no `notFoundComponent`/`defaultNotFoundComponent`.
  Unmatched URLs therefore render the router's stock screen.
- The ported component also still tests `LAYOUTS` against `/_app/...` route ids
  (`:6-13`) — the ELN has no `_app` layout, so that branch can never match.

### 4. Import is transient and append-only — `R5-SURF-04`

- Interface: `routes/_app/import/$importId.tsx` is an addressable per-import
  screen (map/check steps, per-import not-found) and step 1 offers
  `Import into → New dataset`.
- ELN: the whole flow lives in one component with no URL persistence
  (`src/components/import/import-flow.tsx`), and the empty state says "Create a
  dataset from a model first" (`:475-484`) — appending to an existing dataset is
  the only path. No filename-based parser pre-selection either.

### 5. Analysis studio depth — `R5-STUDIO-01..03`

- Interface: `components/analysis/studio-modes.tsx` Analyse mode offers a
  linear/one-way-ANOVA toggle, a fit plot, a Term/Estimate/SE/95% CI/p results
  table and an assumption-check list; `studio-parts.tsx` authors encodings by
  drag-and-drop `FieldList` + `ShelfPill` slots; `StaleBanner` resolves a newer
  snapshot (Keep/Update).
- ELN: `src/lib/analysis-definition.ts:27` defines only `descriptive` and
  `regression`; `src/components/viz/chart-configurator.tsx` assigns fields with
  `NativeSelect` dropdowns; the stale source shows a warning line only
  (`src/routes/analysis/new.tsx:1443`). No "Cited by" column, no Compare A/B
  swap or match-rows-by control. `grep 'ShelfPill|FieldList'` → no matches.

### 6. Review reads as a diff, not as an annotated document — `R5-NOTE-01`

- Interface: `components/review/review-document.tsx` renders inline `ins`/`del`
  marks, a Δ change gutter, change cards inside the document and anchored
  comments.
- ELN: `grep 'ChangeMark|Δ|<ins|</del|tracked'` under `src/components/review` →
  no matches; the ELN presents a structured revision diff
  (`revision-diff-review.tsx`) instead.

### 7. Notebook blocks and e-signature affordances — `R5-NOTE-02`

- Interface: `components/record-notebook/*` includes a signature-request block
  and a corrective-actions block, a generic `ESignDialog`, an outline with a
  required-section checklist and a requested-signature table.
- ELN: no block type for either (`grep 'signature|Action'` in
  `src/components/notebook/block-picker.tsx` → no matches); `grep 'ESignDialog|ESign'`
  over `src/` → no matches (signing is per-flow dialogs plus `ReasonDialog`).

### 8. Home has no quiet state — `R5-HOME-01`

- Interface: `components/home/quiet-home.tsx` — an all-clear banner, "Coming up
  next 2 weeks", "Pick something up", per-project approval progress bars,
  "Continue working", and a Today / Start something / Team activity inspector.
- ELN: `src/routes/index.tsx` is review, recents and first-run oriented
  (`:553`, `:477`, `:618`, `:690`, `:854`); none of the above exists.

### 9. Configuration depth — `R5-CONFIG-01..05`

- **Diagnostics** (`docs/screens/settings-diagnostics.md`): ELN lacks the
  Request ID column with copy, per-row "Checked HH:MM" and the
  "Checks run every 5 minutes" line (`src/routes/settings/diagnostics.tsx:262-284`).
- **Usage** (`settings-usage.md`): no 6-month trends, no plan limits or ≥80/90%
  warning bars, no per-token API breakdown, storage is a plain table
  (`src/routes/settings/usage.tsx`).
- **Instruments** (`instruments.md`): no "How data gets in" selector on register
  (`src/routes/instruments.tsx:815-845`), no last-data/next-booking in the
  inspector, no per-method health.
- **Models** (`models-edit.md`): no submit-for-approval (Approver + reason,
  awaiting-approval state), no stale/merge conflict UI, no section reorder or
  per-type field-editor inspector — the editor publishes directly.
- **Templates** (`templates-in-use.md`, `templates-versions.md`): no
  "Records by version" matrix, no project filter (the param is parsed but
  unused), no change sets, no signatures list, no stale-publish banner,
  no inspector.
- **Milestones** (`project-milestones.md`): no week/month scale, today marker,
  phase bars, dependency lines, at-risk status, start-from-template, date
  history or `?state=stale` 409 banner (the route accepts `denied`/`empty` only).

### 10. Shell, theme and platform affordances — `R5-SHELL-01..06`

- **Shell coverage:** `src/routes/__root.tsx:243-249` lists v3 routes; anything
  outside that allow-list gets the legacy shell, which has no icon rail at
  1024–1279 and no bottom tabs below 768. Product routes affected include
  `/projects/$projectId/files`.
- **Theme:** the inline no-flash script exists, but the preference is in
  `localStorage` (`sheetbase-theme`), not the interface's `sb-theme` cookie — so
  the server always emits the light default and the class is corrected on the
  client.
- **Capability flags:** `src/lib/capabilities.ts:16` has `capabilityKeys = []`
  and `:28` an empty `capabilityRoadmap`, with one live usage site
  (`src/routes/settings/diagnostics.tsx:536`). The interface demonstrates 11
  gaps; most of those capabilities are now genuinely built in the ELN
  (`api.sample_measurements`, experiment results), so an empty registry is
  honest — but nothing can be switched per deployment, and no route has a
  `?state=gap`.
- **Search and pickers:** no "Include archived" scope, no "Did you mean {id}?"
  suggestion (`grep` in `src/components/v3/search/search-palette.tsx` → no
  matches); no shared `FilterMenu` dropdown (lists use chips/checkboxes);
  the record picker's Recent group is unbuilt by design and says so
  (`src/components/v3/record-picker/record-picker.tsx:14-19`).
- **Sign-in:** `src/routes/sign-in.tsx:96-155` is GitHub-only — no
  email/password fallback, no lockout/attempts copy, no workspace line.
- **Pipelines:** plain `<pre><code>` instead of a syntax-highlighted code block
  (`src/routes/pipelines/$pipelineId/index.tsx:145`), no "temporary" artefact
  marker, and steps are a route rather than a `?step=n` parameter.

## Deliberate differences (not defects)

- **`?state=` affordances.** The interface exposes forced states on 16 routes
  (`denied`, `empty`, `stale`, `loading`, `locked`, `promote`, `returned`,
  `sign`, `approved`, `quiet`, `new`, `working`, `checking`, `clear`, `gap`) to
  review designs with fixtures. The ELN keeps only what it cannot derive from
  real data (`denied`, `empty`, `clear`) and drives the rest through real state
  or the parity state driver. Consequence: the ELN's parity registry still
  refuses 31 screens for states it has no hook for
  (`tests/visual/design-states.ts` `DESIGN_PENDING`, first group). If those
  comparisons are wanted, extend the state driver rather than adding query
  parameters to product routes.
- **Route shapes.** Where a route differs, it usually differs by name or
  concentration, not by capability: `/models/$id/new` is
  `/models/$id/records/new`; `/review/$id?state=sign` is
  `/review/$revisionId`; `/pipelines/$id/runs/latest` is
  `/pipelines/<run>/runs/<id>`; `/dev/components` is `/sheetbase-components`
  plus `/foundations`. These are recorded here so a later audit does not
  re-open them.
