# Journeys: pipelines, runs, agents and projects

Domain: PIPELINES, RUNS, AGENTS and PROJECTS (including milestones, project-scoped lists, schedule and inbox hand-offs).
Format: see [README.md](README.md). Every claim cites the code as read on branch `GWP/instrument-parser-journey`.

Path shorthand (all under `/home/user/workspace/repo`):

- `P` = `src/routes/pipelines.tsx`
- `PD` = `src/routes/pipelines/$pipelineId.tsx`
- `PO` = `src/routes/pipelines/$pipelineId/index.tsx`
- `PS` = `src/routes/pipelines/$pipelineId/steps.tsx`
- `PT` = `src/routes/pipelines/$pipelineId/triggers.tsx`
- `PR` = `src/routes/pipelines/$pipelineId/runs/$runId.tsx`
- `AG` = `src/components/v3/pipelines/agents/agent-surface.tsx`
- `MS` = `src/routes/projects/$projectId/milestones.tsx`

---

### J-PIP-01 Create a pipeline and reach its first version
- **Persona / goal:** Pipeline author; register a pipeline and get a runnable version.
- **Entry:** Pipelines list, "New pipeline" dialog (`P:477-598`).
- **Path:**
  1. Fill key and name, then "Create pipeline" (`P:585-595`). Validation names the rule for the key (`P:488-490`).
  2. Success toast: "It has no version yet. Add one in its steps, then publish it so runs can use it." (`P:510-513`). It navigates to the new pipeline (`P:514-517`).
  3. The landing tab is Overview. It shows the EmptyState "No version yet / A pipeline needs a draft version with inputs, a transform and an output before it can run." with no action (`PO:260-270`).
  4. The user must notice the "Steps" tab (`PD:186-189`). There, "No version yet — saving creates the first draft (v1)" and "Create draft v1" (`PS:197-201`, `PS:367-373`).
- **Blockers hit:** the toast disappears; the page that stays says what is missing but gives no button. The header status reads "No version yet" (`PD:140-142`) with no link either.
- **Verdict:** partial (step 3, the EmptyState has no "Add the first version" action).
- **Fix:** give the `PO:263` EmptyState an `action` that links to `/pipelines/$pipelineId/steps`; or land the create navigation on `/steps`.
- **Severity:** S3

### J-PIP-02 "Run now" is disabled and does not say why
- **Persona / goal:** Scientist; run a pipeline they just opened.
- **Entry:** disabled "Run now" button on the list inspector (`P:400-412`) or the pipeline header (`PD:148-156`).
- **Path:**
  1. List inspector: disabled when `!sel.current`, when the current version is a draft, or while pending (`P:404-408`). Only the draft case has copy: "Drafts have no published version to run yet." (`P:426-430`). The no-version case has none. The draft message names no next step and offers no Publish button; the user must Open the pipeline.
  2. Pipeline header: same disable rule (`PD:150-152`) with no copy at all. "Publish draft" sits beside it (`PD:157-165`) only if a draft exists. With no version at all, neither explanation nor remedy is shown.
  3. A retired-only pipeline is the opposite failure. `currentVersion()` falls back to `versions[0]` (`pipelines-data.ts:78-86`) and the disable rule only tests `'draft'`, so Run is enabled on a retired version and the user gets the server refusal toast (`PD:80-84`).
- **Blockers hit:** a disabled primary control with no reason (README rule).
- **Verdict:** partial (list: draft only; header: none; retired: enabled but refused).
- **Fix:** one `runBlockedReason(current)` helper rendered as Muted under both buttons ("Publish draft v2 first" with the publish action; "Add a version in Steps" with a link; "This version is retired").
- **Severity:** S2

### J-PIP-03 Steps editor: "This version cannot be saved yet" that the page cannot fix
- **Persona / goal:** Pipeline author; save a draft whose output keeps a dataset.
- **Entry:** red Notice "This version cannot be saved yet" on the Steps tab (`PS:351-359`).
- **Path:**
  1. Output mode Select offers Create / Append / None unconditionally (`PS:329-331`), although the file header promises it "only offers the modes this version can honestly produce" (`PS:28-30`).
  2. Choose "Create a new dataset". The only extra field is Dataset name (`PS:334-340`). The shared validator (`config.ts:547-554`) also requires `output.schemaVersionId` and (for any non-none mode) `output.datasetLabel` (`config.ts:580-590`). The page has no control for either.
  3. Choose "Append": it needs `datasetId` (`config.ts:569-576`). The page only prints "Appends to the dataset this version is configured with" (`PS:343-345`). That is empty for a new pipeline.
  4. The Notice lists "create output requires a valid Dataset Schema Version id" and "output requires a Dataset Version label". Save and Publish are disabled by `canSave` (`PS:140`, `PS:364`, `PS:377`).
- **Blockers hit:** the error names fields that are not editable anywhere in the UI. The hint says "configured on the version, not here" (`PS:320`) but no place configures it. For a new pipeline only `none` is saveable, so no pipeline can keep a dataset via the UI.
- **Verdict:** dead-end (step 4). Fixed in 3e4165ee.
- **Fix:** hide Create/Append until the page can supply the target (or add a schema-version picker, dataset picker and label field). Until then render the Notice with the action "Choose Keep nothing, or configure the output through the API" and a docs link.
- **Severity:** S1

### J-PIP-04 "Run now" on a pipeline that declares inputs
- **Persona / goal:** Scientist; run a published pipeline against the latest data.
- **Entry:** "Run now" (`P:241-267`, `PD:65-85`), then toast "Could not start the run".
- **Path:**
  1. The Steps editor lets the author add inputs and mark them Required (`PS:236-313`).
  2. Run now calls `startPipelineRun` with `triggerKind: 'manual'` only. `parameters` and `inputVersions` default to `{}` (`P:245-249`, `PD:68-72`, `data.ts:133-147`).
  3. The database rule requires every declared input in `input_versions`: `missing_input` / "missing input: <name>" (`drizzle/0265_pipeline_run_request_errors_fix.sql:94-96`). Required parameters are likewise refused (`drizzle/0140_auto_01_03_pipelines.sql` `missing_parameter`).
  4. The toast shows the raw message or "The database refused it." (`P:261-266`). There is no dataset-version picker or parameter form anywhere in `src/routes/pipelines*`; `grep inputVersions` in those routes finds nothing.
  5. Separately, no UI code calls `executePipelineRun` (only server libs and `data.ts:166`), so a run that does start depends on a server-side sweep that this audit did not find for manual runs. Treat as an unverified risk.
- **Blockers hit:** the user is told an input is missing and given no way to supply it.
- **Verdict:** dead-end (step 4) for any pipeline with at least one declared input. Fixed in 499371d3. Confirmed nothing executed a manual run (start_pipeline_run only inserts a running row; the scheduler sweep only drives its own schedules), so Run now now also calls the execute route.
- **Fix:** a "Run with…" dialog listing each input (dataset-version picker, defaulting to the latest) and each parameter; disable Run now with that dialog as the action when inputs are declared.
- **Severity:** S1

### J-PIP-05 Trigger warning: "no published version, so its triggers will not fire"
- **Persona / goal:** Pipeline author; make a schedule actually run.
- **Entry:** warn Notice on Triggers (`PT:280-285`), or a row reading "No published version" (`PT:205-206`).
- **Path:**
  1. Add a trigger. The dialog does not warn that nothing is published (`PT:406-409`). The success toast says "It starts runs of the published version." (`PT:378-381`).
  2. The Notice says "Publish a version to activate them." It has no button or link. Publishing lives in the header "Publish draft" (`PD:157-165`) only if a draft exists. With no draft the user must go to Steps (`PS:361-374`), create a draft, return and publish.
  3. A timed trigger whose spec is readable but has no `next_run_at` shows "Never fires" with no reason (`PT:209-211`). Unreadable specs do get a clear remedy: "Delete it and add a new trigger" (`PT:273-279`).
- **Blockers hit:** a warning with no action; a "Never fires" cell with no cause.
- **Verdict:** partial (steps 2-3).
- **Fix:** add an `action` to the `PT:281` Notice: "Publish draft v2" when a draft exists, otherwise a link to Steps; explain "Never fires" (paused vs. no schedule computed).
- **Severity:** S3

### J-PIP-06 A run failed: what now?
- **Persona / goal:** Pipeline owner; recover from a failed run.
- **Entry:** Pipelines "Needs attention" tab (`P:106`), list inspector "Recent runs" link (`P:449-466`), or the failed run page.
- **Path:**
  1. The run page shows a red Banner titled with `error_code` and the message (`PR:230-234`).
  2. Header actions exist only for `running` (Cancel run, `PR:198-227`). There is no "Run again" or "Retry".
  3. `startPipelineRun` accepts `retryOfRunId` (`data.ts:124`, `data.ts:145`), and the run page displays "Retry of" (`PR:382-385`), but nothing in the UI sets it.
  4. If a run fails with no `error_message`, the Banner is not rendered at all (`PR:230`). The user sees only a red status chip and log lines.
  5. The user can go back and press Run now, which makes an unlinked run (and see J-PIP-04 for pipelines with inputs).
- **Blockers hit:** an error with no next action; retry lineage exists in the data model but not the UI.
- **Verdict:** dead-end (step 2). Fixed in 47f844cc.
- **Fix:** "Retry this run" in the header for `failed`/`cancelled` calling `startPipelineRun({ retryOfRunId, inputVersions: r.input_versions, parameters: r.parameters })`; render the Banner for any failed run with a fallback message and a "See the log" anchor.
- **Severity:** S2

### J-PIP-07 "This run is waiting for you": answer the confirm prompt
- **Persona / goal:** Asked reviewer; decide a paused step.
- **Entry:** warn Banner "This run is waiting for you." (`PR:236-242`).
- **Path:**
  1. The prompt panel renders the proposal table, typed fields, a Reason box, and Confirm / Skip / Stop (`run-prompt.tsx:261-385`).
  2. Reason is mandatory for Confirm and Skip but only enforced on click with "Say why, so the decision is clear in the record." (`run-prompt.tsx:222-225`). The label says "required" (`run-prompt.tsx:353`).
  3. Required typed fields are labelled "required" (`run-prompt.tsx:286-288`) but never checked client-side before submit.
  4. Controls render for anyone who opens the run while it is `waiting` (`PR:249`, `run-prompt.tsx:275-281`). The panel never says whether the viewer is one of the asked people, so a non-asked user finds out from the toast after submitting (`PR:115-118`).
  5. If no prompt row is readable, a Notice says to reload and that "the run has no recorded prompt left to answer" (`PR:261-270`). No owner is named.
  6. The UI offers no way to author a `confirm` step (the Steps editor edits one transform statement, `PS:213-234`), so waiting runs only come from API-authored configurations.
- **Blockers hit:** the happy path works. Edge states do not name who can resolve them.
- **Verdict:** partial (steps 3-5).
- **Fix:** show "You are asked" / "Asked: A, B. You can view this run but not answer it"; validate required fields before submit; in the no-prompt Notice name the pipeline owner.
- **Severity:** S3

### J-PIP-08 Inbox hand-off for a failed or waiting run
- **Persona / goal:** Asked person; act on an Inbox "Waiting for your decision" or "Failed" item.
- **Entry:** Inbox row of kind `run_waiting` / `run_failed` (`inbox.tsx:83-98`), inspector "Open" (`inbox.tsx:664-666`).
- **Path:**
  1. `itemLink` sends both kinds to `/pipelines` (`inbox.tsx:148-149`), the unfiltered list.
  2. The view emits `source_id` = prompt id for waiting items (`drizzle/0397_work_items_run_waiting.sql`, `'pipeline_run_prompt', p.id`) and `NULL` for failed ones (`drizzle/0269_my_work_items_kinds.sql`, `NULL::uuid`). Neither the run id nor the pipeline id is carried, and the Inbox ignores `sourceId` for these kinds.
  3. The row identity is only the pipeline key and name (`pd.key, pd.name`). On the list the user must find that pipeline, select it, and open "Recent runs".
  4. The Pipelines "Needs attention" tab counts only `lastRun.status === 'failed'` (`P:106`). A waiting run is not in it, so the one filter built for this job hides the hand-off the Inbox just sent.
- **Blockers hit:** a "Needs your decision" item lands on a list where the decision is two clicks away and not highlighted. An expiring prompt (`p.expires_at` is the due date) can lapse in between.
- **Verdict:** partial (steps 1-4). Fixed in 86fecd6c (run resolved client-side from the prompt id or pipeline key; the view should expose the run id).
- **Fix:** have the view expose `pr.id` and `pd.id`; link to `/pipelines/$pipelineId/runs/$runId` (`/pipelines/runs/$runId` already redirects, `src/routes/pipelines/runs/$runId.tsx:21-31`); include `waiting` in `needsattention`.
- **Severity:** S2

### J-PIP-09 Not found, unreadable and failed reads render blank pages
- **Persona / goal:** Anyone following a link to a pipeline, run or project that is gone, unshared, or whose read failed.
- **Entry:** `/pipelines`, `/pipelines/<id>`, `/pipelines/<id>/runs/<id>`, `/projects/<id>`.
- **Path:**
  1. Pipelines list: no `isError` branch (`P` has none). A failed read gives `rows = []` and the EmptyState "No pipelines in all" with only "Search looks at pipeline keys and names." (`P:350-375`), plus a "0" header total. There is no retry. A genuine first-time workspace gets the same text, with no "New pipeline" action in the EmptyState.
  2. Pipeline detail: `!d` renders only a header reading "Pipeline not found" (`PD:111-122`), whether the id is wrong, access is denied, or the read failed.
  3. Run page: only "Run not found" (`PR:161-169`). The sibling redirect route does the right thing (`src/routes/pipelines/runs/$runId.tsx:545-553`: error Notice).
  4. Project: header only "Project not found" (`projects/$projectId.tsx:62-70`), and `ProjectOverview` returns `null` when the project is missing (`projects/$projectId/index.tsx:94`).
  5. Contrast: the projects list handles load failure well, with a deadline, a message and "Try again" (`projects.tsx:154-177`, `projects-page.tsx:457-464`); the project tabs use `ProjectListFailure` (`experiments.tsx:66-75`).
- **Blockers hit:** the user cannot tell "missing" from "forbidden" from "network"; no retry or way back beyond the breadcrumb.
- **Verdict:** dead-end (steps 1-4). Fixed in 47f844cc (pipelines list, pipeline, run, project).
- **Fix:** a shared `NotFound` / `LoadFailed` block (cause, "Try again", "Back to Pipelines", owner/admin to ask for access); add the list-level error branch and the "New pipeline" action to the empty state.
- **Severity:** S2

### J-PIP-10 A user without pipeline rights tries to create, save, publish, run or trigger
- **Persona / goal:** Workspace member without `pipelines.manage`.
- **Entry:** any enabled pipeline control.
- **Path:**
  1. No pipeline route consults `hasCapability`. `grep -n hasCapability` over `P`, `PD`, `steps.tsx` and `triggers.tsx` finds nothing. Compare Agents, which does gate (`agents.tsx:241-249`).
  2. "New pipeline", "Save draft", "Publish version", "Add trigger", "Pause/Enable" and "Delete" are all live.
  3. Refusals surface only as toasts carrying the raw message or "The database refused it." (`P:519-526`, `PD:102-106`, `PS:163-165`, `PT:146-150`). The "New pipeline" dialog keeps the user's form but offers no explanation or contact.
- **Blockers hit:** the refusal does not name the missing right or who can grant it.
- **Verdict:** partial (steps 2-3).
- **Fix:** read the capability once in the layout; disable with the reason "Your role cannot manage pipelines. Ask a workspace owner or admin." (copy already exists for projects, `projects-page.tsx:105-107`).
- **Severity:** S2

### J-PIP-11 Agent proposals: pending, failed, and workflows that stop
- **Persona / goal:** Steward or ordinary member reviewing agent work on `/pipelines/agents`.
- **Entry:** Proposals tab group "Awaiting approval" (`AG:154`), a Notice, or a workflow status.
- **Path:**
  1. Cannot approve: the Decision section says "Your role can inspect this proposal but cannot approve its canonical operation." (`AG:324-328`). It names no role or person. Capability depends on operation kind (`agents.tsx:241-247`), but the copy never says which. The group label "Awaiting approval" deliberately claims no one has picked it up (`AG:143-146`).
  2. Failed proposal: shows the error code/message (`AG:278-282`). An approver then sees "No decision is available for this proposal." (`AG:320`). No retry, re-propose or link to the producing run/workflow.
  3. Paused workflow: has a Notice and a "Resume exact step" button (`AG:512-518`, `AG:540-547`). This is complete.
  4. `budget_exhausted` is terminal (`AG:448-452`) and shows only a red status. No Notice explains it and nothing offers a way to raise the budget or start a new workflow.
  5. Empty states ("No operation proposals", "No agent workflows") say where items come from but give no action (`AG:187-191`, `AG:440-444`).
  6. Top-level errors render as a bare red `<p role="alert">` of the raw message (`agents.tsx:328-335`). Mutations have no success toast.
- **Blockers hit:** step 1 names no resolver; steps 2 and 4 end in a terminal state with no next move.
- **Verdict:** partial (steps 1, 2, 4).
- **Fix:** name the approving roles per operation kind ("A Data Steward or workspace owner can approve this"); a failed-proposal Notice with "Open the workflow" / "Ask the agent client to re-propose"; a `budget_exhausted` Notice with the limits reached.
- **Severity:** S2

### J-PIP-12 "No service credentials": delegating agent writes
- **Persona / goal:** Workspace owner or Data Steward; let an agent credential append rows without a human each time.
- **Entry:** warn Notice "No service credentials" on the Policies tab (`AG:729-745`).
- **Path:**
  1. The Notice explains the cause and carries a button "Open API and SDK" linking to `/settings/api` (`AG:732-742`).
  2. After creating a credential and returning, the credential list refreshes through `credentialsQuery` (`agents.tsx:96-100`) and the form's Select picks it (`AG:703-706`).
  3. Non-managers see "Only a workspace owner or Data Steward can change policies." (`AG:851-854`) and, in the empty state, "Ask a workspace owner or Data Steward to delegate one." (`AG:926-930`). Both name the resolver.
  4. The empty state's "Create the first policy" focuses the name field (`AG:933-939`).
- **Blockers hit:** minor. "Create policy" is disabled with no list of what is missing (`AG:845`). `valid` does not require a Target id for non-workspace targets (`AG:709-716`) and the field takes a raw "Canonical id" (`AG:806-818`).
- **Verdict:** complete (the warning names the cause, the resolver and the next action; the friction in the form is separate).
- **Fix:** none for the journey; later, a target picker instead of a raw id and per-field errors.
- **Severity:** S3

### J-PIP-13 Notebook pipeline-output block: absent, unreadable or read-only proposal
- **Persona / goal:** Notebook author or reader; accept a pipeline's proposed update, or pin a run's output.
- **Entry:** block states in `pipeline-output-block-preview.tsx` and `-editor.tsx`.
- **Path:**
  1. No proposal pinned: stated absence, "No pipeline proposal is linked to this block. Pipeline actions currently apply directly when a run succeeds; PIPE-03 propose mode writes a proposal…" (`pipeline-output-block-proposal.tsx:46-47`, `:341-354`). It uses a roadmap ID and gives no link or action.
  2. Unreadable proposal: "…may belong to another workspace, or it may have been withdrawn." (`:50-51`). It names no resolver and has no link.
  3. Read-only preview with a pending proposal: link text "Decide this proposal in the pipeline run" (`:275-285`) points to `/pipelines/agents?view=proposals`, not the run. The label and target disagree.
  4. Editor, run picker: only the 20 most recent runs (`-editor.tsx:127-131`). With none, the Select shows just "Select a run…" and no hint or link to Pipelines. A run with no outputs gives "This run produced no recorded output." with no next step (`:247-253`).
  5. "Clear reference" stays disabled until the user touches the picker (`:285`), so a pre-existing wrong reference cannot be cleared first.
  6. A failed proposal shows the error text only (`:270-272`).
- **Blockers hit:** several messages state a condition and stop.
- **Verdict:** partial (steps 1-5).
- **Fix:** replace the absent-message with plain copy and a link to `/pipelines`; correct the link label to "Decide this in Agents"; empty-picker hint with a link; enable Clear when a reference exists.
- **Severity:** S2

### J-PIP-14 Milestone is Late / At risk: how does the owner clear it?
- **Persona / goal:** Project editor; get a late milestone back on track or mark it done.
- **Entry:** red Notice "Late" or amber "At risk" (`MS:530-540`), row/timeline status.
- **Path:**
  1. The Notice gives `riskReason` and the rule (`MS:102-103`). It has no action.
  2. "Move date…" is available to editors (`MS:771-777`). Its dialog requires a reason and warns that later milestones do not move (`MS:1185-1186`). This part works.
  3. "Mark done" needs every condition delivered **and** at least one condition (`MS:778-792`). The explanation shows only when some condition is open (`MS:795-806`, "Mark done needs every condition met. N still open."). With zero conditions the button is disabled with no explanation beyond a separate "No conditions recorded for this milestone." (`MS:823`).
  4. Open conditions are plain text chips (`MS:811-818`). There is no link to the record that would deliver them. The page says "A milestone only counts as done once its linked records are delivered." (`MS:744-746`) and the Add dialog says "A milestone names the records that prove it’s done." (`MS:1101`).
  5. No UI creates a condition or links a record. `planner.ts` exports only `fetchStudyDeliverables` (`planner.ts:445`) and `createStudyTask` takes no conditions (`MS:420-433`). A milestone made in this UI therefore has zero conditions and can never be marked done here. Late stays late; the only exit is Move date.
- **Blockers hit:** Late/At risk plus a permanently disabled Mark done.
- **Verdict:** dead-end (steps 3-5). Fixed in 04fd82ea.
- **Fix:** "Add condition" and "Link record" actions in "Done when"; make each open condition a link to its record; state "Add a condition to enable Mark done" for the zero-conditions case.
- **Severity:** S1

### J-PIP-15 Milestones page: empty plan, or edit controls disabled while permissions load or are denied
- **Persona / goal:** Project member planning deliverables.
- **Entry:** disabled "Add a milestone" / "Add milestone" / "Start from a template…" (`MS:625-631`, `MS:673-688`).
- **Path:**
  1. `denied = state === 'denied' || !canEdit` and `canEdit` is false until the permission query answers (`MS:161-162`). In the populated view a Notice explains: "You can view this plan but not change it. Only project editors can add milestones, move dates or mark them done." (`MS:665-669`). It names a group, not a person.
  2. In the empty-plan branch (`MS:615-642`) the same buttons are `disabled={denied}` but the Notice is not rendered. A viewer sees an EmptyState and a dead primary button with no reason. The template section's "Use this template…" is disabled likewise (`MS:594`).
  3. If `tasks` fails to load, there is no error branch (only `tasks.isLoading`, `MS:556`), so the failure also shows "No milestones yet".
  4. The project Overview's "Add a milestone" link (`projects/$projectId/index.tsx:222-234`) sends everyone to this page regardless of rights.
  5. Template path works for editors: "No other project in this workspace has milestones to start from yet. Add milestones one by one." (`MS:608-612`).
- **Blockers hit:** a disabled primary action with no cause; a load failure presented as an empty plan.
- **Verdict:** partial (steps 2-3). Fixed in 04fd82ea.
- **Fix:** hoist the denied Notice above both branches and name the project lead (as `members.tsx:191-195` does: "Ask them to add people"); add a `tasks.isError` branch with retry.
- **Severity:** S2

### J-PIP-16 Project-scoped empty lists and the project list
- **Persona / goal:** Project member on a new project; start populating samples, datasets and files.
- **Entry:** project tabs "No samples yet", "No datasets yet", "No files yet" (`samples.tsx:139-143`, `datasets.tsx:57-61`, `files.tsx:268-272`).
- **Path:**
  1. Each passes `empty={{icon,title,body}}` and no `action` (`project-list.tsx:106-109` would render one). Copy: "Samples registered against this project appear here.", "Datasets imported into this project appear here.", "Files uploaded to this project's records appear here."
  2. Header links go to the global lists ("All samples" `samples.tsx:89-92`, "All datasets" `datasets.tsx:82-85`). The samples and datasets pages have no create or import path from here, and the empty state does not point at `/import`.
  3. Experiments is the good case: "New experiment" in the header, `project={projectId}` prefilled (`experiments.tsx:96-115`).
  4. Project list: no-access vs. none-yet vs. cannot-create are distinct. "Ask a workspace owner or admin…" is stated (`projects-page.tsx:106-107`, `1067-1081`, `project-access.ts:52-53`).
  5. Archived: "New experiment" silently disappears from the header (`projects/$projectId.tsx` `project.archivedAt ? null`) with no "this project is archived" explanation on that page.
- **Blockers hit:** "appear here" with no way to make them appear; silent removal of an action for archived projects.
- **Verdict:** partial (steps 1, 2, 5; the list itself is fine).
- **Fix:** empty `action`s: "Import a dataset" to `/import`, "Register a sample", "Open a record to attach a file"; an Archived banner on project pages.
- **Severity:** S3

### J-PIP-17 Schedule: instrument bookings that fail to load or cannot be cancelled
- **Persona / goal:** Scientist; see and book instrument time.
- **Entry:** `/schedule` (`schedule.tsx`).
- **Path:**
  1. No instruments: EmptyState "No instruments configured" with "Open the instrument registry" (`schedule.tsx:262-276`). Complete for that state.
  2. Load failure: neither query has an error branch (`schedule.tsx:146-152`; no `isError` anywhere in the file). A failed read shows an empty grid, a "no bookings of yours" subtitle (`:195-198`), and for a failed instrument read the "No instruments configured" EmptyState is skipped, because it requires `isSuccess`, so the week renders blank.
  3. Weekend or empty day overlay: "No bookings on <day>" with the explanation "Bookings are created as tentative and weekends are bookable like any other day." (`:510-520`).
  4. Open any booking, including a colleague's. The dialog shows "Cancel booking" enabled for everyone (`:372-379`). Refusal comes back as `describeCalendarError` text (`:199-203`). The user can read "Booked by <name>" but is not told to ask them.
- **Blockers hit:** failure rendered as emptiness; a cancel control offered where it will be refused.
- **Verdict:** partial (steps 2 and 4).
- **Fix:** an error banner with "Try again" when either query fails; disable "Cancel booking" for others' bookings with "Booked by X. Ask them to cancel it."
- **Severity:** S2

---

## Summary

| ID | Title | Verdict | Severity |
| --- | --- | --- | --- |
| J-PIP-01 | Create a pipeline and reach its first version | partial | S3 |
| J-PIP-02 | "Run now" disabled without a reason | partial | S2 |
| J-PIP-03 | Steps editor "cannot be saved yet" that cannot be fixed | dead-end | S1 |
| J-PIP-04 | "Run now" on a pipeline with declared inputs | dead-end | S1 |
| J-PIP-05 | Trigger warning "no published version" | partial | S3 |
| J-PIP-06 | A run failed: what now | dead-end | S2 |
| J-PIP-07 | "This run is waiting for you" prompt | partial | S3 |
| J-PIP-08 | Inbox hand-off for failed or waiting run | partial | S2 |
| J-PIP-09 | Not found, unreadable and failed reads render blank | dead-end | S2 |
| J-PIP-10 | No pipeline rights: controls live, refusal is a toast | partial | S2 |
| J-PIP-11 | Agent proposals pending, failed, workflows that stop | partial | S2 |
| J-PIP-12 | "No service credentials": delegating agent writes | complete | S3 |
| J-PIP-13 | Notebook pipeline-output block states | partial | S2 |
| J-PIP-14 | Milestone Late / At risk and Mark done | dead-end | S1 |
| J-PIP-15 | Milestones page empty / denied / load failure | partial | S2 |
| J-PIP-16 | Project-scoped empty lists | partial | S3 |
| J-PIP-17 | Schedule load failure and cancelling others' bookings | partial | S2 |

Counts: complete 1, partial 11, dead-end 5. Severity: S1 3, S2 9, S3 5.
