# Journeys: datasets, readings, analysis, models, experiments, sheets

Domain code `DAT`. Traced on branch `GWP/instrument-parser-journey` by reading
the route and component code. Paths are relative to `src/`. Line numbers are as
read on that branch. Nothing was run in a browser; where a claim rests on
reading code alone and a data shape I could not confirm, it says "likely".

Shorthand: `rows.tsx` = `routes/datasets/$datasetId/rows.tsx`,
`snapshots.tsx` = `routes/datasets/$datasetId/snapshots.tsx`,
`compare.tsx` = `routes/datasets/$datasetId/compare.tsx`,
`value-actions` = `components/v3/datasets/value-actions.tsx`,
`readings/new` = `routes/readings/new.tsx`,
`studio` = `routes/analysis/new.tsx`,
`sheet-ws` = `components/sheet/canonical-sheet-workspace.tsx`.

---

### J-DAT-01 Dataset shows "N columns missing units" and the user wants it fixed
- **Persona / goal:** Lab scientist who must submit an experiment; the dataset blocks it on units.
- **Entry:** Datasets list, selected row shows the status "1 column missing a unit" and the inspector button "Open and fix" (`routes/datasets.tsx:350-362`, text from `components/v3/datasets/datasets-data.ts:90-96,107-119`).
- **Path:**
  1. Click "Open and fix". It is a plain link to `/datasets/$datasetId/rows` (`routes/datasets.tsx:354-361`).
  2. The Data tab loads a read-only grid. The only banner says "Snapshot … · read-only; values change only by import" (`rows.tsx:317-319`).
  3. The inspector offers "Mark out of range…" and "Request repeat" only (`value-actions:294-313`). Neither sets a unit. The `missing_unit` flag appears in the label map (`value-actions:51-56`) but no action creates a unit, and "Clear flag" would dismiss the rule rather than fix the cause.
  4. Nothing links to the model's Fields tab, to Edit model, or to Import.
- **Blockers hit:** "“Dose” has no unit. Units are required before EXP-0012 can be submitted." (`datasets-data.ts:115-118`). The sentence names the blocker but not where the unit is set. The button label "Open and fix" promises a fix the destination cannot give.
- **Verdict:** `dead-end` at step 2. The user is told to fix, and no fixing control exists on the screen. **Update: fixed in 78c8c3d8.**
- **Fix:** Make `datasetIssueSummary` name the real fix, and link it. The unit is a model field property, so link to `/models/$modelId/edit?field=<key>` (the route already accepts `field`, `models/$modelId/edit.tsx:122-131`). Alternatively say "re-import with a unit column" with a link to `/import`. Rename the button to "Open dataset" when the flag cannot be cleared in place.
- **Severity:** S1 (blocks experiment submission, a regulated step).

### J-DAT-02 A value is flagged out of range and needs correcting
- **Persona / goal:** Analyst who sees a red value in the rows grid and wants to correct or exclude it.
- **Entry:** Rows grid; a flagged value shows `text-danger-text` and the inspector card "Out of range · System rule" (`rows.tsx:211-217,405-436`; `value-actions:231-289`).
- **Path:**
  1. Select the value. The inspector shows kind, reason, rule threshold and evaluated value (`value-actions:259-267`).
  2. "Clear flag" on a system flag opens a dialog that requires a reason, then records the override (`value-actions:189-194,460-520`). This part is complete.
  3. To correct the number itself there is no control. `rows.tsx:399` says "Select a value to act on it", and `rows.tsx:318` says values change only by import. `MarkOutOfRangeDialog` states the value "is excluded from criteria and analyses until you or a reviewer change that" (`value-actions:391-395`). No screen lets either person change it.
  4. A read-only user sees "You have read access to this dataset, so flag and repeat actions are unavailable. Ask a workspace writer." (`value-actions:224-229`). It names a role, not a person, and the buttons stay visible but disabled (`value-actions:297,304`).
- **Blockers hit:** The "or a reviewer change that" copy implies an edit path that does not exist in the UI. "Mark out of range…" can also be clicked on a value that already carries an out-of-range flag (`value-actions:295-301` has no already-flagged guard).
- **Verdict:** `partial`. Flag, override and repeat work. Correction does not: the path stops at "values change only by import" with no link to the import flow or to re-measurement. **Update: fixed in 78c8c3d8.**
- **Fix:** Add a "Correct by re-import" link to `/import` (with `?dataset=`) beside the read-only line. Reword `value-actions:392-394` to say how the value would change. Disable "Mark out of range" when a manual flag already exists.
- **Severity:** S1 (a regulated correction has no route).

### J-DAT-03 Dataset has no snapshot, or the Create snapshot button is disabled
- **Persona / goal:** Writer who opened Data on a dataset with no snapshot, or who wants to freeze rows before an edit.
- **Entry:** Data tab empty state "No snapshot to read rows from" (`rows.tsx:252-274`); Snapshots tab with a disabled "Create snapshot" (`snapshots.tsx:283-292`).
- **Path:**
  1. Data tab offers a "Create a snapshot" button that links to Snapshots (`rows.tsx:259-271`). This is a real next step for a writer.
  2. On Snapshots, "Create snapshot" is disabled when the user is read-only, the revision read is loading or failed, the dataset is missing, or it is archived. The reason is one string passed as `title` (`snapshots.tsx:161-175,288`). A `title` attribute is invisible on touch and to most keyboard users.
  3. Visible companions: a read-only notice "…Ask a workspace writer." (`snapshots.tsx:314-319`), and a failed revision read shows "Refresh the page to try again." (`snapshots.tsx:272-277`).
  4. An archived dataset shows "Archived datasets cannot be snapshotted." and no way to restore it (title only; the Overview says the same at `routes/datasets/$datasetId/index.tsx:129-136`).
  5. Empty list copy, "No snapshots yet. Snapshot the dataset to freeze its rows as evidence", is plain muted text (`snapshots.tsx:307-313`). It does not point at the button above it. A failed versions query falls into the same branch, so an error reads as "No snapshots yet" (no `versions.isError` check, `snapshots.tsx:309-311`).
  6. On the Data tab a failed versions or rows query is not checked (`rows.tsx:107-128`). A failed rows read for a chosen `?snapshot=` leaves `payload` undefined and shows "No rows match" with "Clear search and filters" (`rows.tsx:336-366`), which cannot help.
- **Blockers hit:** Disabled reasons live only in `title`. Archived has no recovery or owner. Error and empty are conflated.
- **Verdict:** `partial`. A writer on a healthy dataset completes it. Every other cause stops at a muted line.
- **Fix:** Render `snapshotDisabledReason` as visible helper text under the button. Add `versions.isError`/`rowsQuery.isError` notices with Retry. Name who can unarchive (owner/admin) for the archived case.
- **Severity:** S2.

### J-DAT-04 Retention warning says a snapshot will be pruned
- **Persona / goal:** Dataset owner who sees a prune warning and wants to keep the rows.
- **Entry:** Warn notice at the top of Snapshots with action "Keep <label>" (`snapshots.tsx:245-267`).
- **Path:**
  1. Notice title and detail come from `mostUrgentPruneWarning` (`snapshots.tsx:135`). The "Keep …" button opens the Keep dialog for that exact snapshot (`snapshots.tsx:251-262`).
  2. Dialog requires a reason, up to 500 chars, with inline error and a hint that it is stored with the snapshot (`snapshots.tsx:594-675`). Copy says a signed record still takes precedence.
  3. Success toast: "Snapshot X kept … Its rows will not be removed by retention while the keep is in force." (`snapshots.tsx:218-221`). Failures use `describeKeepError` (`snapshots.tsx:223-226`).
  4. The inspector repeats a Keep button and the retention rule (`snapshots.tsx:388-412`). A tombstoned snapshot explains what is left and why (`snapshots.tsx:377-399`).
  5. A read-only user loses the button but keeps the notice, plus "Ask a workspace writer." (`snapshots.tsx:314-319`).
- **Blockers hit:** None that strand the user.
- **Verdict:** `complete`.
- **Fix:** None needed. Minor: the read-only copy could name the dataset owner.
- **Severity:** S3 (copy only).

### J-DAT-05 Compare has fewer than two snapshots, or compares a removed snapshot
- **Persona / goal:** Reviewer who wants to see what changed between two imports.
- **Entry:** Compare tab, or "Compare snapshots" in the Snapshots inspector.
- **Path:**
  1. With one snapshot or none, the Compare tab shows a muted line: "Compare needs two snapshots. Save another to compare changes." (`compare.tsx:290-297`). There is no link or button to the Snapshots tab. The Snapshots inspector says the same, "Save another snapshot to compare changes." (`snapshots.tsx:449-451`), with nothing to click.
  2. The Compare picker and the inspector picker list every other snapshot, including ones whose rows were removed by retention (`snapshots.tsx:236-240,431-435`; compare.tsx picker `compare.tsx:314-345`). Only the current snapshot is guarded (`snapshots.tsx:414-419`). Comparing against a removed snapshot likely returns an RPC error.
  3. That error shows "The comparison could not be loaded." plus the raw database message, with no Retry and no hint that the cause is a removed snapshot (`compare.tsx:368-375`). The snapshots-list failure is the same (`compare.tsx:278-288`).
  4. "No differences between these snapshots." is a clear empty result (`compare.tsx:386-388`).
- **Blockers hit:** Dead muted text where a CTA belongs; unexplained RPC failure for tombstones.
- **Verdict:** `partial`.
- **Fix:** Turn `compare.tsx:293-295` into an EmptyState with a "Go to Snapshots" button. Filter or label tombstoned versions in both pickers ("rows removed"). Add Retry to both error notices.
- **Severity:** S3 for the empty state, S2 for the tombstone error.

### J-DAT-06 "Request repeat" is disabled in the value inspector
- **Persona / goal:** Writer who wants a repeat measurement for a bad value.
- **Entry:** Inspector for a selected value; "Request repeat" is greyed out (`value-actions:302-313`).
- **Path:**
  1. The button needs a source sample. `useRowSourceSample` looks for a reference field holding a sample record id, or a text field whose key or label contains "sample" and whose value equals a sample identifier (`rows.tsx:478-527`). Otherwise the button is disabled.
  2. The only explanation is the `title` text "No source sample is linked to this row, so a repeat cannot be requested from here." (`value-actions:305-309`). It is invisible to touch and keyboard users, and gives no remedy.
  3. The rule is invisible to the user: a column named "Specimen" or "Well ID" never matches. Nothing says what the dataset needs.
  4. Read-only users are told to "Ask a workspace writer" (`value-actions:224-229`).
  5. Success is clear: a toast names the derived sample and the planned rows (`value-actions:204-216`). It has no link to the new sample or to the Readings form where the value will be entered.
- **Blockers hit:** Silent disabled state with a hover-only reason; no route to link a sample; no next link after success.
- **Verdict:** `partial`. It works when the dataset has the expected sample column, and strands the user otherwise.
- **Fix:** Show the disabled reason as visible text under the buttons, and say which field the dataset needs. After success, add a toast action "Record reading" linking to `/readings/new?sample=<id>` (the route already reads `sample`, `readings/new:39-41`).
- **Severity:** S2.

### J-DAT-07 Record reading: "No planned rows to fill"
- **Persona / goal:** Bench scientist who opened Record reading to log a value.
- **Entry:** `/readings/new`, warn notice "No planned rows to fill" (`readings/new:282-286`).
- **Path:**
  1. The form lists only datasets that have a planned row (`readings/new:97-100`). If none exist, the Dataset and Planned row selects are replaced by the notice: "Readings are recorded into a planned dataset row. Request a repeat in a dataset first, then return here."
  2. The notice has no action. The user must remember to open Datasets, find a dataset with a source sample, select a value, and press "Request repeat" (see J-DAT-06), which itself may be disabled.
  3. Meanwhile "Save reading" stays visibly enabled-looking but is disabled with no reason (`readings/new:442`), because `canSubmit` needs a planned key (`readings/new:154-159`).
  4. If there are no samples, the only hint is plain text at the bottom: "Register a sample first; a reading is measured against one." (`readings/new:451-455`). It is not a link, and is below the fold on mobile.
  5. Samples, datasets and planned-row queries have no error branch (`readings/new:62-76`). A failed load looks the same as having none.
- **Blockers hit:** The bench user gets a prerequisite from another screen, with no link to it and no explanation of a disabled Save.
- **Verdict:** `dead-end` at step 2 for anyone who did not arrive from a repeat request. **Update: fixed in d79d015f.**
- **Fix:** Give the notice an action "Open datasets" (`/datasets?tab=issues`) and make "Register a sample first" a link to `/samples`. Add query-error notices with Retry. Show a one-line reason under the disabled Save button.
- **Severity:** S2.

### J-DAT-08 Record reading: "No numeric fields" and "No sample field"
- **Persona / goal:** Scientist who picked a dataset whose schema is unsuited to bench entry.
- **Entry:** Warn notices "No numeric fields" and "No sample field" (`readings/new:328-339`).
- **Path:**
  1. "No numeric fields: This dataset has no numeric field to record a reading against." (`readings/new:328-332`). The Measurement select becomes "No measurement field" and is disabled (`readings/new:341-357`). Save is disabled with no reason.
  2. The user can switch Dataset (`readings/new:289-307`), but the list does not say which datasets have numeric fields. Nothing links to the model's field editor, and no owner is named.
  3. "No sample field: …the reading will not be linked to the sample." (`readings/new:334-339`). The form still allows saving, so the evidence is unlinked from the sample the user selected. There is no confirmation that they accept this, and no fix link.
  4. The dilution and note controls appear only if the dataset happens to contain matching fields (`readings/new:124-133,375-391,413-417`), so a missing dilution field silently removes the control.
- **Blockers hit:** Two warnings, neither with an action. The second lets a reading be saved with a known loss of traceability.
- **Verdict:** `dead-end` for "No numeric fields"; `partial` for "No sample field". **Update: fixed in d79d015f.**
- **Fix:** In "No numeric fields", link to `/models/<modelId>/fields` for the dataset's model, and say a model owner or admin adds fields. In "No sample field", name the dataset, offer "Choose another dataset", or require an explicit tick before save.
- **Severity:** S2 (the unlinked save is arguably S1 for evidence; see J-DAT-09 for the same pattern).

### J-DAT-09 Record reading: value out of range, and save errors
- **Persona / goal:** Scientist entering a result that may break the field's range.
- **Entry:** Warn notice "Out of range: This value will be recorded and flagged for review, not rejected." (`readings/new:407-411`).
- **Path:**
  1. Out-of-range is detected from the field's rule (`lib/readings-data.ts:232-241`). The notice does not state the range, or the field it is measured against, so the user cannot judge whether they mistyped.
  2. Save proceeds, flags the value, and the toast says "· flagged out of range" (`readings/new:214-218`), then navigates to the sample's measurements page (`readings/new:230-233`). That page, not the flagged dataset value, is where the user lands.
  3. Validation copy "Enter a number, 0 or more." is only shown when `touched` is true (`readings/new:363-365`). `touched` is set only inside `onSubmit` (`readings/new:254-257`), but the submit button is disabled whenever the value is invalid (`readings/new:442`), and implicit Enter-submit is blocked by a disabled default button. The inline error is therefore likely unreachable: the user sees a dead Save button and no message.
  4. Negative numbers are rejected (`readings/new:149-150`), including legitimate negative readings (for example a baseline-corrected delta).
  5. Server refusals surface only as a toast. "The dataset changed. Reload and try again." (`lib/readings-data.ts:369`) has no reload action, and the dataset query is cached 30s (`readings/new:67-71`), so retrying likely resends the same stale revision. "This dataset is archived…" and "The value is outside the field's allowed range." (`lib/readings-data.ts:370,375`) give no next step.
- **Blockers hit:** Hidden validation message; stale-revision loop; errors only in a transient toast.
- **Verdict:** `partial`. **Update: fixed in d79d015f (disabled-Save reason only).**
- **Fix:** Show the field's range in the notice. Set `touched` on blur, or keep Save enabled and validate on submit. On `stale_dataset_revision`, refetch datasets and keep the entered value. Persist the failure in an inline `Notice`. Allow negatives where the field's rule permits them.
- **Severity:** S2.

### J-DAT-10 Analysis home or a saved analysis has an invalid or unreadable spec
- **Persona / goal:** Analyst who opens Analysis, or opens a saved view whose spec no longer validates.
- **Entry:** `/analysis` list, or `/analysis/$analysisId` showing "This saved spec is not valid" (`routes/analysis/$analysisId.tsx:203-208`).
- **Path:**
  1. On the read-only view, `validateAnalysisSpec` failing shows a warn notice: "Open it in the studio to repair it. The stored spec is kept as it was saved." The header action "Edit in studio" links to `/analysis/new?view=<id>` (`$analysisId.tsx:154-161`), and the inspector lists up to five errors (`$analysisId.tsx:232-242`).
  2. The studio loads the spec straight into state (`studio:416-451`) and shows a "Specification problems" alert listing every error (`studio:1743-1755`). The user can fix fields and press Update. The repair path is complete when the spec is well-formed but semantically wrong.
  3. Both `loadView` and the `?view=` effect read `view.spec.datasets[0]` without a guard (`studio:417,445`), as do the read-only page (`$analysisId.tsx:124`) and the list (`routes/analysis/index.tsx:142,179`). A stored spec with no `datasets` array would likely throw a TypeError during render. On the list that would take down the whole Analysis home for every user in the workspace, not just the owner of the bad view. There is no test for an invalid saved spec in `routes/analysis/$analysisId.test.tsx`.
  4. A failed `analysis_views` read on the home is not handled. It falls through to "No analyses yet … Pick how you want to start" (`routes/analysis/index.tsx:334-338,219-222`), so an outage reads as an empty workspace. The same happens on the read-only view, where a failed read becomes "This analysis does not exist" (`$analysisId.tsx:101-122`).
  5. If the `?view=` id is not in the loaded list, the studio silently opens blank (`studio:441-444`).
- **Blockers hit:** Valid-shape invalid specs are recoverable. Malformed specs, and fetch errors, are not.
- **Verdict:** `partial`. The documented repair journey works; the crash and error-as-empty cases do not. **Update: fixed in 34623b5b (crash guard; error-as-empty not done).**
- **Fix:** Guard `spec.datasets?.[0]`. Add `views.isError`, `viewQuery.isError` branches with Retry. When `?view=` is missing, show "That analysis was not found".
- **Severity:** S2 (S1 if one malformed spec can break the shared list).

### J-DAT-11 Analysis banner says "Sources changed" (stale), or the analysis is cited
- **Persona / goal:** Analyst whose dataset has moved on since the analysis was saved.
- **Entry:** Warn notice in the read-only view (`$analysisId.tsx:164-168`), status "Sources changed" (`$analysisId.tsx:141-142`).
- **Path:**
  1. The read-only page shows the detail text and nothing to act on. The resolution buttons "Keep rN" and "Update to rN" exist only in the studio (`studio:1805-1830`), so the user has to know to press "Edit in studio" and then find the banner.
  2. If the analysis is cited, Update is disabled and a short reason appears: "Updating in place is unavailable while the source is removed or the analysis is cited." (`studio:1663-1667,1823-1838`). The copy advises "Save a new analysis and cite that to move on" (`$analysisId.tsx:183-191`; `studio:1069`).
  3. The studio has no "Save as new" control. When a view is loaded the single save button reads "Update" (`studio:1186-1192`), and `saveAnalysisView` updates whenever an id is set (`lib/analysis-studio-data.ts:358-361`). The only ways to detach seem to be switching dataset or deleting the view (`studio:260-262`, delete at `studio:1198-1236`), and deleting a cited view is presumably refused. The advice therefore has no button behind it.
  4. "A source dataset is no longer available; keep the pinned version or re-author the analysis" (`studio:1788-1792`) has no link to the dataset or to a recreate action.
  5. If the source check fails, both pages say so in the banner, and the studio says "the resolution actions are unavailable" with no retry (`studio:1799-1804`; `$analysisId.tsx:169-174`).
- **Blockers hit:** The remedy is named but missing for cited analyses; no entry to the remedy from the page that raised the warning.
- **Verdict:** `partial` (uncited analysis: complete in the studio; cited analysis: dead-end at step 3). **Update: fixed in 02e46e2f (Save as new).**
- **Fix:** Add "Review in studio" to the read-only banner, deep-linking with `?view=`. Add "Save as new analysis" next to Update. Add Retry to the source-check failure.
- **Severity:** S2.

### J-DAT-12 Dataset model has no version, or no fields
- **Persona / goal:** Model owner who just created a model and opened its tabs.
- **Entry:** Fields tab "No version yet" (`routes/models/$modelId/fields.tsx:121-124`), Versions tab "No versions yet" (`routes/models/$modelId/versions.tsx:156-166`), Datasets tab "No datasets use this model" (`routes/models/$modelId/datasets.tsx:73-77`).
- **Path:**
  1. Both Fields and Versions say "Start a version from the header, add fields, then publish it."
  2. The header of a dataset model has one button, "Edit model" (`routes/models/$modelId.tsx:121-130`). There is no "Start a version" control in the header. The real route is Edit model, then "Start draft" (`routes/models/$modelId/edit.tsx:484-488,520-532`). The copy points at a control that is not there.
  3. "No fields on this version: Add fields to the draft version, then publish it" (`fields.tsx:139-142`) has no link either, and does not say whether a draft exists.
  4. These three empty states have no `action` prop at all, though the edit route is one link away.
  5. "Model not found" has no action or link back (`$modelId.tsx:90-97`); a failed definition read does get Try again (`$modelId.tsx:68-89`).
  6. A user without `schema.edit` reaches Edit model and sees "View only. Only model owners and admins can change <name>." with a disabled Start draft (`edit.tsx:493-498,484,527`). That at least names the roles that can resolve it.
- **Blockers hit:** Copy refers to a header control that does not exist.
- **Verdict:** `partial`. The edit route is complete; the way there is not signposted. **Update: fixed in b54d425b.**
- **Fix:** Add an action "Edit model" to the empty states in `fields.tsx` and `versions.tsx`, or add a real "Start version" header button. Add a back link to "Model not found".
- **Severity:** S2.

### J-DAT-13 Editing a model draft: stale save, locked draft, publish gating
- **Persona / goal:** Model owner editing a draft that a colleague also edits, then publishing it.
- **Entry:** `/models/$modelId/edit`; banners for conflict, lock and approval (`edit.tsx:493-516`).
- **Path:**
  1. Autosave sends the revision it read. A stale refusal re-reads the server state and sets a conflict (`edit.tsx:255-285`), showing `DraftConflictBanner` with "Reload theirs", "Merge and keep editing" (when fields do not overlap) or a danger-styled "Keep mine" (when they do), plus the count of fields changed elsewhere (`components/v3/models/draft-conflict-banner.tsx:36-81`). Handlers at `edit.tsx:362-391`. Nothing is overwritten without a choice. The status line says "Not saved: draft changed on the server" (`edit.tsx:399-401`).
  2. A locked draft (open approval request) disables every edit control (`edit.tsx:174`). The approval panel says who must approve and offers Withdraw (`components/v3/models/model-approval-panel.tsx:255-290`). A refused save while locked says "Withdraw the submission to keep editing" (`edit.tsx:289-294`).
  3. Field-contract problems are named inline, per field (`edit.tsx:1229-1314`), and the header status says "Not saved: fix N fields" (`edit.tsx:403-408`).
  4. "Submit for approval" and "Publish" are disabled when there are no changes or any field has an issue (`edit.tsx:465,474`), with no visible reason for the zero-changes case, though the "0 changes since v…" counter is on the page (`edit.tsx:557-560`).
  5. A non-owner sees View only, naming owners and admins (`edit.tsx:493-498`).
- **Blockers hit:** Only the disabled-without-reason buttons (minor).
- **Verdict:** `complete`. The conflict journey is the model for the rest of this domain.
- **Fix:** Optional: add a `title`/helper for "No changes to publish", and name who changed the draft in the conflict banner.
- **Severity:** S3.

### J-DAT-14 Record-model versions: start a draft, save a stale draft, publish
- **Persona / goal:** Owner of a workspace record model (for example a Sample type) changing its fields.
- **Entry:** `/models/<key>/versions`, no draft, or a draft with errors (`components/v3/models/record-model-versions.tsx:196-228`).
- **Path:**
  1. "Reason for draft" is required before "Start draft vN" enables (`record-model-versions.tsx:206-229`). The disabled reason is the empty field next to it. Complete.
  2. A user without `schema.edit` sees neither the form nor any explanation: the whole form is gated by `!draft && canEdit` (`record-model-versions.tsx:206`), with only "No version is published yet" or "Published vN stays in use…" (`record-model-versions.tsx:200-205`).
  3. Save sends `expectedRevision` (`record-model-versions.tsx:131-145`). On a stale revision the `onError` handler only shows the raw message (`record-model-versions.tsx:112-116`), and the queries are invalidated only on success (`record-model-versions.tsx:98-105`). There is no reload, merge or keep-mine option (compare J-DAT-13), so a retry resends the same revision.
  4. With "also migrate open experiments" selected, the definition is saved first and the migration second (`record-model-versions.tsx:146-157`). If the migration fails, the draft is already changed, and the user sees only the thrown message at the top of the page.
  5. "Approval history unavailable. Publication is disabled." (`record-model-versions.tsx:321-324`) is shown as red text with no Retry, unlike the dataset-model page which offers one (`routes/models/$modelId/versions.tsx:288-303`). Publish is hidden whenever the approval state is not satisfied, without a stated reason (`record-model-versions.tsx:393-404`).
- **Blockers hit:** Stale-save error with no recovery; permission-hidden controls; two-phase save with partial failure.
- **Verdict:** `partial`.
- **Fix:** Reuse `DraftConflictBanner` for the stale case, or at least refetch and keep the typed changes. Add Retry to the approval error. Say "Only model owners and admins can start a draft" when `canEdit` is false.
- **Severity:** S2.

### J-DAT-15 Experiment tabs for datasets and results are empty, or a result dataset has issues
- **Persona / goal:** Scientist wrapping up an experiment who expects to see produced datasets and analyses and then record a decision.
- **Entry:** Experiment > Datasets ("No datasets linked"), Results ("No cited analyses", "No datasets"), Overview (`routes/experiments/$expId/datasets.tsx:12-13`, `-links-tab.tsx:65-71`, `results.tsx:179-205`, `components/overview/overview-view.tsx:380-384`).
- **Path:**
  1. Empty copy: "Datasets produced by this experiment appear here when they are linked." No button to import, create, or link one, and no sentence says how a link is made. The same for Samples and Files (`samples.tsx:12-13`, `files.tsx:12-13`). In Results the analyses text says "Cite an analysis in this experiment's notebook" (`results.tsx:180-184`) with no link to the notebook or to the Analysis studio.
  2. When a dataset is linked and has problems, Results shows a red "N issues" status (`results.tsx:146-158`). The dataset name is plain text (`results.tsx:123-129`), so there is no click-through to the dataset, whereas the Overview does link datasets (`overview-view.tsx:342-354`).
  3. "Record decision" is always enabled and gives no warning that the linked datasets have unresolved issues (`results.tsx:208-225`). Whether the server enforces anything on `set_experiment_decision` I could not confirm from the client code.
  4. A dataset linked by identifier but not resolved (`target_record_id` null) renders as plain text (`-links-tab.tsx:42-44`).
  5. A failed record read is shown as "Experiment not found" with no action (`routes/experiments/$expId.tsx:100-111`; `overview.tsx` shows the same text, `routes/experiments/$expId/overview.tsx:113-119`).
  6. Contrast: the Overview readiness list is actionable, with "Go to cell" and "Fill in" links to the exact block and an explicit "No location resolves this: …" line when it cannot (`overview-view.tsx:119-157`).
- **Blockers hit:** Empty states explain nothing about how to populate them; issues without a link to the broken dataset.
- **Verdict:** `partial`.
- **Fix:** Add actions to `LinkTab`'s empty state (to the notebook, or `/import?experiment=<id>`), make result-dataset names links to `/datasets/<uuid>`, show a hint under "Record decision" when any linked dataset has issues, and add a back link plus error branch to "Experiment not found".
- **Severity:** S2.

### J-DAT-16 Sheet: "Calculation results are stale", a formula that fails, or the sheet cannot load
- **Persona / goal:** Scientist working in a sheet with local columns and calculations.
- **Entry:** Footer text of the sheet workspace, "Calculation results are stale. Recalculate after edits." (`sheet-ws:2151-2155`; status from `sheet-ws:1673-1675`).
- **Path:**
  1. The message names an action, "Recalculate". A search for `recalculat` across the canonical workspace finds only this sentence. The `Recalculate` menu item exists in the other sheet component, `components/sheet/scientific-sheet-block.tsx:2096-2101`, not here. The user has no control to press.
  2. Adding a calculation is a bare "Formula" input, a "Label" input and "Add calculation" (`sheet-ws:1810-1835`). There is no validation or hint before submit (`sheet-ws:993-1049` sends the string as is). A server refusal appears as one red line in the footer, far from the form (`sheet-ws:2160-2164`).
  3. A load failure shows only "This Sheet could not be loaded." (`sheet-ws:336-342`). It does not distinguish permission, not found or network, and offers no Retry or link back. The page header meanwhile still shows "Sheet" and "Loading…" (`routes/sheets/$sheetId.tsx:121-127`).
  4. On `/sheets/new`, "Create blank sheet" is disabled until a project is chosen, with the select's "Choose a project…" as the only cue (`routes/sheets/new.tsx:180-206`). With no projects the select is empty, with no "Create a project" link, and a failed project query is not handled (`new.tsx:86-89`). The four start cards do link out correctly (`new.tsx:137-174`).
- **Blockers hit:** A named action that does not exist; a terse unexplained failure.
- **Verdict:** `dead-end` for stale calculations at step 1; `partial` for the rest. **Update: fixed in 6a2e8604 (Recalculate only).**
- **Fix:** Add a "Recalculate" button beside the stale message (reuse the handler behind `scientific-sheet-block.tsx:2098`). Show the load error text with Retry and a link to the project. Link "Choose a project…" to `/projects` when empty.
- **Severity:** S2.

### J-DAT-17 Sheet shows "N open cell conflicts"
- **Persona / goal:** User whose offline edits collided with someone else's on the same cell.
- **Entry:** Footer status "N open cell conflict(s)" with "Review first conflict" (`sheet-ws:2093-2110`).
- **Path:**
  1. "Review first conflict" selects the cell, which opens the conflict panel in the inspector (`sheet-ws:745-755,2262-2290`).
  2. `CellConflictPanel` shows both attributable edits with author and time, lets the user pick yours, theirs or a typed value, and requires a reason up to 2000 chars (`components/sheet/cell-conflict-panel.tsx:137-200`). The resolve button stays disabled until value and reason are valid, and the field error says "Enter a value to resolve with." (`cell-conflict-panel.tsx:282,313`). Failures show in an inline `Notice` (`cell-conflict-panel.tsx:301-304`). The settled state records who decided and why, and says both values stay in History (`cell-conflict-panel.tsx:324,366-382`).
  3. After resolving, the sheet and the work-item list refresh (`sheet-ws:2276-2285`).
  4. Gap: `revealFirstConflict` returns silently when the conflict's row key or column is not in the current matrix (`sheet-ws:748-753`). The button then does nothing, with no message, and the count stays. Whether a hidden or retired column can produce this I could not confirm.
  5. The panel does not check the user's write permission before offering Resolve. A read-only viewer would meet the server's refusal in the error notice.
- **Blockers hit:** Only the silent no-op in step 4.
- **Verdict:** `partial` (the resolution flow itself is complete; the entry button can fail silently).
- **Fix:** When the cell cannot be revealed, show a status "That cell is hidden or removed; show hidden columns to review it" with a link action to unhide (`sheet-ws:1897-1905`). Hide or disable Resolve with a reason for read-only viewers.
- **Severity:** S3.

---

## Summary

| ID | Title | Verdict | Severity |
| --- | --- | --- | --- |
| J-DAT-01 | Dataset "missing units": "Open and fix" cannot fix | dead-end | S1 |
| J-DAT-02 | Out-of-range value needs correcting | partial | S1 |
| J-DAT-03 | No snapshot / Create snapshot disabled | partial | S2 |
| J-DAT-04 | Retention warning to Keep a snapshot | complete | S3 |
| J-DAT-05 | Compare with fewer than two snapshots, or a removed one | partial | S3 (S2 for tombstones) |
| J-DAT-06 | "Request repeat" disabled | partial | S2 |
| J-DAT-07 | Record reading: "No planned rows to fill" | dead-end | S2 |
| J-DAT-08 | Record reading: "No numeric fields" / "No sample field" | dead-end | S2 |
| J-DAT-09 | Record reading: out of range and save errors | partial | S2 |
| J-DAT-10 | Invalid saved analysis spec; analysis list failure | partial | S2 |
| J-DAT-11 | Analysis "Sources changed" / cited analysis | partial | S2 |
| J-DAT-12 | Dataset model has no version or fields | partial | S2 |
| J-DAT-13 | Model draft: stale save, lock, publish | complete | S3 |
| J-DAT-14 | Record-model versions: stale save, publish gating | partial | S2 |
| J-DAT-15 | Experiment datasets/results empty or with issues | partial | S2 |
| J-DAT-16 | Sheet: stale calculation, formula, load failure | dead-end | S2 |
| J-DAT-17 | Sheet cell conflicts | partial | S3 |

Counts: complete 2, partial 11, dead-end 4 (17 journeys).
