# Journeys: Notebook, records, templates, protocols, signing and review

Audited against the working tree on branch `GWP/instrument-parser-journey`
(code read, not run). Paths are relative to `src/` unless stated. Format is
defined in `docs/qa/journeys/README.md`.

Cross-cutting observation: the review workspace (`routes/review/$revisionId.tsx`)
has been hardened with a distinct sentence for almost every signing refusal
(QA-183/184, R5-SHELL-05). The Notebook-side surfaces that do the same job
(`SignNotebookDialog`, `SubmitNotebookDialog`, the record header, the offline
replay notice, the archived banner) were not given the same treatment, and most
of the findings below are that gap.

---

### J-NBK-01 Start a new notebook from a template
- **Persona / goal:** Scientist who wants a notebook that already has its sections, sheets and parameters from a published template.
- **Entry:** `/sheets/new` card "From a template" ("Start from a notebook template that already has its sheets and fields.") (`routes/sheets/new.tsx:61-66`), or `/templates` directly.
- **Path:**
  1. `/sheets/new` card links to `/templates` (`routes/sheets/new.tsx:65`).
  2. `/templates` offers only `NewTemplateDialog` (authoring a template) and a row inspector with Details / Versions / "Reuse is deliberate" (`routes/templates.tsx:232-236`, `:369-413`). No "Use template" / "New notebook" action.
  3. `/templates/$templateId` has Edit, versions, in-use and update tabs (`routes/templates/$templateId/index.tsx`); none creates a notebook.
  4. `/experiments/new` (the only create-notebook form) calls `createBlankExperiment` and has no template field (`routes/experiments/new.tsx:235-241`, `lib/notebook-create.ts:9`).
  5. `instantiateNotebookTemplateVersion` exists (`lib/notebook-template-data.ts:283`) but has no caller outside tests and stories (grep of `src/`).
- **Blockers hit:** none shown. The user is simply sent to a page where the next step does not exist. Publishing toast says "New notebooks can start from it; existing ones are not changed." (`routes/templates/$templateId/versions.tsx:607`), promising a path the UI lacks.
- **Verdict:** `dead-end` (step 2: the card's destination has no instantiate action).
- **Fix:** add "New notebook from v{n}" to the template inspector and detail header (project picker + title, call `instantiateNotebookTemplateVersion`), and add the same template select to `/experiments/new`. Until then, change the `/sheets/new` card copy so it does not promise this.
- **Severity:** S1 (a core reuse feature, and the product's template-versioning story, has no entry point).

### J-NBK-02 "New template version" banner on a locked notebook
- **Persona / goal:** Author of a signed notebook sees "Template X has a new version" and wants to take it.
- **Entry:** `NotebookTemplateUpgradeBanner` ("…This notebook stays on v1 until you choose." with button "Review v2") (`components/notebook/notebook-template-upgrade-banner.tsx:181-184`).
- **Path:**
  1. The route hides the banner only for historical and archived views (`routes/records/$recordId/notebook.tsx:803-813`), so it shows on a locked notebook directly above `LockedBanner` (`:814`).
  2. "Review v2" opens `/templates/$templateId/update?record=…` (`notebook-template-upgrade-banner.tsx:170-174`).
  3. The update page loads a preview and enables "Apply v2" without checking `locked_at` (`routes/templates/$templateId/update.tsx:117-130`; `components/v3/templates/template-update-view.tsx:437-441`).
  4. Apply is refused by the RPC with `record is locked` (SB011) (`drizzle/0119_core_065_template_placement_data_boundary.sql:328`), shown as a bare "Could not update the notebook" notice (`template-update-view.tsx:268-270`).
- **Blockers hit:** raw `record is locked`. The only mention of the real rule is a static footnote, "Signed records cannot be updated; use an amendment." (`template-update-view.tsx:453-454`), with no link to amend. The notebook already carries the Amend button (`notebook.tsx:1538-1548`) but the update page does not point back to it.
- **Verdict:** `dead-end` (step 3: the user does a full preview and conflict-decision pass before the refusal).
- **Fix:** suppress the banner when `lockedAt` is set, or swap it for "Amend first to take v2". On the update page, read `locked_at` (already fetched at `components/v3/templates/templates-data.ts:172`), disable Apply, and show "This notebook is signed. Amend it, then update" with a link back to the notebook.
- **Severity:** S2.

### J-NBK-03 Publish or retire a template version
- **Persona / goal:** Template author wants to publish a draft, or retire an old version.
- **Entry:** `/templates/$templateId/versions`, "Publish v{n}…" or "Retire v{n}…" (`routes/templates/$templateId/versions.tsx:395-427`).
- **Path:**
  1. The "View only. Only template owners and QA can publish or retire versions." notice and the hidden buttons are driven only by the URL param `?state=denied` (`versions.tsx:56-64`, `:218`, `:307-311`). There is no capability or role check in the file. A member who is neither owner nor QA sees an enabled Publish button, enters a reason, and gets the server's raw message.
  2. Retire needs a typed "Signature meaning" (free text, no password step) (`versions.tsx:668-678`).
  3. Retire refusals are rewritten to text only: "You haven't certified your electronic signature. Set it up in Settings › Electronic signatures…" and "Unsigned records are still on this version. Ask their owners to update them or finish and sign them, then retire." (`versions.tsx:714-719`). Neither is a link; the second does not name the records or link to the in-use tab that lists them (`routes/templates/$templateId/in-use.tsx`).
- **Blockers hit:** exact copy above; also the stale-draft notice does have a Reload action (`versions.tsx:313-328`), which is the one part that is complete.
- **Verdict:** `partial` (steps 1 and 3).
- **Fix:** derive `denied` from the workspace role as `settings/signatures.tsx:128-130` does; link "Settings › Electronic signatures" to `/settings/signatures`; link "Unsigned records" to `/templates/$templateId/in-use?v=…` and show the count.
- **Severity:** S2.

### J-NBK-04 Open a protocol that needs editing or review
- **Persona / goal:** Protocol author (or QA) lands on a draft protocol and wants to edit it or send it for review so a version is frozen.
- **Entry:** `/protocols` empty tab ("No protocols in {tab}") or `/protocols/$protocolId` Version history empty state "No frozen versions yet — A version is frozen when the protocol is submitted for review." (`routes/protocols/$protocolId.tsx:319-323`, `:399-403`).
- **Path:**
  1. `/protocols` header has no create action; the empty state only offers "Clear search" when a query is active and nothing otherwise (`routes/protocols.tsx:263-284`).
  2. The detail page renders the "Working document" read-only via `ProtocolDocument` (`protocols/$protocolId.tsx:249-256`). No link to the record's notebook, no Submit, no Edit.
  3. The "Training" tab empty state repeats the "frozen when submitted" rule with no action (`:399-403`).
  4. A non-record or unreadable protocol shows only a header "Protocol not found" with no body and no way back except the breadcrumb (`:98-108`).
- **Blockers hit:** the page explains the rule that creates a version but supplies no route to satisfy it; no protocol-creation UI exists anywhere (grep for `protocol_template` shows only list/pickers).
- **Verdict:** `dead-end` (step 2).
- **Fix:** add "Open working document" (`/records/$protocolId/notebook`) and a Submit-for-review action on the detail header, a "New protocol" action on the list, and an `EmptyState` body for "not found".
- **Severity:** S2 (protocol versions gate experiment starts, see J-NBK-05).

### J-NBK-05 Start an experiment against a protocol whose version is not acknowledged
- **Persona / goal:** Operator ticks "Start the experiment now" with a protocol version selected.
- **Entry:** `/experiments/new`, hint "Only effective versions can start an experiment." (`routes/experiments/new.tsx:385-387`).
- **Path:**
  1. One mutation creates the draft record, sets fields, applies setup, then calls `start_experiment` (`new.tsx:235-283`).
  2. The RPC enforces exact-version acknowledgement (LAB-07) but the dialog never says so up front; the acknowledgement lives on `/protocols/$protocolId?section=training` (`protocol-version-training.tsx:52-59`, `:106-110`).
  3. On refusal `createErrorMessage` rewrites only archived and RLS errors (`new.tsx:64-73`); anything else is the raw RPC message in an inline alert (`new.tsx:452-456`) with no link to the Training tab.
  4. The draft record from step 1 already exists. The form stays put, the user is not told a draft was created, and clicking Create again makes a second record.
- **Blockers hit:** raw message; silent orphan; the Training tab's own refusal ("Only a workspace writer can acknowledge a protocol version.", `protocol-version-training.tsx:109`) names no person who can.
- **Verdict:** `partial` (steps 3 and 4).
- **Fix:** map the acknowledgement refusal to "You have not acknowledged v{n}. Acknowledge it on the protocol's Training tab" with a link; on partial failure navigate to the created draft with the error, or roll back.
- **Severity:** S2.

### J-NBK-06 Submit for review from the notebook header
- **Persona / goal:** Author freezes the notebook for review. Variants: a view-only member; an author with unsaved edits.
- **Entry:** header "Submit" button, then `SubmitNotebookDialog` (`routes/records/$recordId/notebook.tsx:1126-1141`).
- **Path:**
  1. `canSubmit` and `canSign` test only record state and ids, never role (`notebook.tsx:953-966`); the only capability check in the file is on the canvas (`:849`). A viewer therefore sees an enabled Submit (and Sign when approved) beside a canvas that is already view-only, and finds out from a server refusal. Duplicate has the same gap (`:1118-1121`).
  2. Reviewer list defaults to the author, "You (role)" (`components/notebook/submit-notebook-dialog.tsx:150-152`). The sign surface later says "You submitted this revision, so you cannot sign it" (`routes/review/$revisionId.tsx:2575`), so a default self-selection can strand the review with nobody able to sign.
  3. Unsaved drafts fail the checklist: "Blocks with unsaved drafts are not part of the server snapshot — save or discard them before submitting." (`lib/notebook-submission.ts:57-63`). The dialog has no save or discard control, does not say which block, and Submit stays disabled (`submit-notebook-dialog.tsx:645-662`).
  4. If workflows fail to load: "Review workflows could not be loaded. Submission is unavailable." (`:416-418`) with no retry.
- **Blockers hit:** exact copy above.
- **Verdict:** `partial` (steps 1, 3, 4).
- **Fix:** gate Submit/Sign/Duplicate on `hasCapability(role, 'record.create')` with the view-only bar's "Request edit access" as the alternative; name the dirty block(s) and add "Save all"; add Retry to the workflow notice; do not preselect the author as the only reviewer.
- **Severity:** S2.

### J-NBK-07 Submit under a workflow that needs an authored signature, not certified
- **Persona / goal:** Author submits under a workflow flagged "Authored signature required".
- **Entry:** `SubmitNotebookDialog` Authored signature fieldset (`submit-notebook-dialog.tsx:456-488`).
- **Path:**
  1. The fieldset asks for signing password and typed name; it claims "Your independently verified identity, current certification and signing password are required" (`:462-464`) but never reads the author's certification (the sign dialog does, `components/notebook/sign-notebook-dialog.tsx:87-101`).
  2. After the user enters both and clicks Submit, the step-up/RPC refuses with `current signature certification required` (`drizzle/0315_signature_password_gates.sql:39`) shown verbatim in a red notice (`submit-notebook-dialog.tsx:638`). The password was already cleared (`:213`).
  3. No link to `/settings/signatures`, and no mention that identity verification needs another administrator.
  4. Session expiry mid-submit is not handled either: `isExpiredSigningSession` is used only in the review route (`routes/review/$revisionId.tsx:2432`).
- **Blockers hit:** raw message after the work is done.
- **Verdict:** `partial` (steps 1-3; the cause is named, the action is not).
- **Fix:** reuse the certification lookup from `SignNotebookDialog`, show the same warn Notice with "Open signature settings" before the password field, and disable the fieldset with that reason. Handle expired sessions as the review route does.
- **Severity:** S1 (blocks submission in the regulated workflow).

### J-NBK-08 Sign from the notebook, signature not certified
- **Persona / goal:** Approved reviewer or approver clicks Sign.
- **Entry:** Notice "Certification is required before you can sign. Your electronic signature is not certified for this workspace…" (`components/notebook/sign-notebook-dialog.tsx:199-216`; the review page equivalent is `routes/review/$revisionId.tsx:2561-2569`).
- **Path:**
  1. "Open signature settings" goes to `/settings/signatures` (`:212`).
  2. That page requires, in order: an independent administrator to verify identity, enrol or recover a signing password by emailed one-use secret, agree to the statement, then certify (`routes/settings/signatures.tsx:249-270`, `:390-396`, `:667-735`).
  3. The dialog's summary names two steps and omits password enrolment (`sign-notebook-dialog.tsx:206-210`).
  4. The requester is told "Ask a different active owner or administrator…" (`signatures.tsx:264`) but no one is named, and no notification or inbox item is raised for the administrator: `verificationRequested` is read only by the signatures and members pages (`signatures.tsx:262`, `:448`; `routes/settings/members.tsx:360`), and the work-item kinds contain nothing for it (`lib/work-items/data.ts:17-27`).
  5. Administrators can act in "People without a certified signature" via "Verify {name} independently" (`signatures.tsx:432-451`).
- **Blockers hit:** exact copy above. After certifying, the user has to come back to the notebook by hand; no return link.
- **Verdict:** `partial` (steps 3-4: the link is good, the dependency on a specific person is invisible).
- **Fix:** list the active owners/admins who can verify; raise an inbox item or notification for the requested verification; add `?next=` so settings returns the user to the record.
- **Severity:** S2.

### J-NBK-09 Sign blocked because review checks have not passed
- **Persona / goal:** Assigned reviewer, or a witness, wants to sign but checks are missing or failing.
- **Entry:** Notebook dialog: "Signing requires the revision's review checks to have passed for this digest. Run the checks and resolve any blocking failures before signing." (`components/notebook/sign-notebook-dialog.tsx:187-191`); review page equivalent `routes/review/$revisionId.tsx:2599-2603`.
- **Path:**
  1. The notebook dialog tells the user to "run the checks" but gives no link to `/review/$revisionId` (checks tab), and the dialog is a dead end with only Close (`components/notebook/e-sign-dialog.tsx:248-250`).
  2. On the review page the "Run checks" button renders only when `permission.canReview === true && integrityDigest !== null` (`routes/review/$revisionId.tsx:850-852`, `:1487`). A witness signer (`signatureMeaning=witnessed`, an explicit witness request) is not an assigned reviewer, so they are told to run checks they have no button for, and the message names nobody who can.
  3. The author likewise cannot run them, and is told only the same sentence.
- **Blockers hit:** exact copy above.
- **Verdict:** `dead-end` for witnesses (step 2); `partial` for reviewers (step 1).
- **Fix:** add a link to the review checks tab in the notebook dialog; when the viewer cannot run checks, say "Ask {assigned reviewers} to run the checks" and list them from `assigned_reviewer_user_ids`; or let signers with `canSign` run checks.
- **Severity:** S1 (a witnessed signature cannot be completed without out-of-band help).

### J-NBK-10 Sign dialog with no eligible meaning, or an expired session
- **Persona / goal:** Any user who clicks Sign (shown to everyone once approved or locked) and hits a refusal.
- **Entry:** `SignNotebookDialog` blocked body, and the step-up error path.
- **Path:**
  1. Header Sign is not role-gated (`routes/records/$recordId/notebook.tsx:961-966`, `:1144-1158`).
  2. When none of the preconditions hold the dialog says: "No eligible signature meaning is available. Signing requires an active frozen revision, assignment as a nonauthor reviewer or an explicit witness request, current workspace write permission, and review checks that have passed for this digest." (`sign-notebook-dialog.tsx:192-198`). It lists five rules without saying which fails. The review page splits these into six distinct sentences (author, not assigned, superseded, role, checks, generic; `routes/review/$revisionId.tsx:2574-2609`).
  3. If the session has lapsed the step-up returns `session_expired`; the notebook dialog shows the server message in `errorMessage` (`sign-notebook-dialog.tsx:173-180`) with no redirect, whereas the review page navigates to sign-in with `next` set (`routes/review/$revisionId.tsx:2432-2438`, `lib/signatures.ts:421-426`).
  4. A disabled Sign button inside the dialog has no stated reason when the name does not match or the digest is "Unavailable" (`e-sign-dialog.tsx:128-133`, `:184`, `:252`).
- **Blockers hit:** exact copy above.
- **Verdict:** `dead-end` for the generic block (step 2), `partial` for expiry (step 3).
- **Fix:** reuse the review page's ordered reason chain in the notebook dialog, or send the user to the review page's panel; handle `isExpiredSigningSession` here; add a one-line reason beside the disabled Sign button.
- **Severity:** S2.

### J-NBK-11 Review actions disabled, or the revision was superseded
- **Persona / goal:** Reviewer or author on `/review/$revisionId` who cannot Approve, Reject, Request changes or Withdraw.
- **Entry:** disabled decision buttons; banners "You do not have permission to act on this review." and "This revision has been superseded by a newer submission. No review actions are available." (`routes/review/$revisionId.tsx:1031`, `:1013`).
- **Path:**
  1. The specific reason is only in a `title` tooltip on the disabled button (`:2062`, from `lib/review-workspace.ts:304-315`), invisible to touch and keyboard users.
  2. The visible banner is generic, names neither the assigned reviewers nor the submitter, and offers no action (`:1031`).
  3. The superseded banner and the "sign the active submission instead" copy (`:2591`) give no link to the newer revision, although `superseded_by_revision_id` is available on the row.
  4. An inactive review says "No further actions are available." (`:1023`) with no pointer to the record or the next revision.
- **Blockers hit:** exact copy above.
- **Verdict:** `partial` (steps 1-3).
- **Fix:** render `blockedReasonLabel` as visible text under the buttons, list the assigned reviewers, and link "Open the current submission" via `superseded_by_revision_id`.
- **Severity:** S2.

### J-NBK-12 Reviewer opens an Inbox review item
- **Persona / goal:** Assigned reviewer clicks a "Review requested" row, or a witness request, in `/inbox`.
- **Entry:** Inbox row Open (`routes/inbox.tsx:125-153`, `:556-587`).
- **Path:**
  1. `itemLink` sends `witness_requested` to `/review/$revisionId?signatureMeaning=witnessed` (good), but plain `review_requested` rows have no `revision_id` (`drizzle/0269_my_work_items_kinds.sql:13-23`; the column is added only for witness rows at `drizzle/0317_rev02_signature_authority.sql:272`) so they fall through to `/records/$recordId` (`inbox.tsx:148-152`), the author's working notebook.
  2. The reviewer then needs the header link "Open review" (`notebook.tsx:1160-1168`), a small text link that appears only when a review revision id resolves.
  3. `data_issue` opens `/datasets` and `run_failed`/`run_waiting` open `/pipelines`, both generic lists with no item filter (`inbox.tsx:140-146`); `cell_conflict` opens the record, not the cell (`inbox.tsx:148`).
  4. Phone view is honest: "Reviewing and signing need a larger screen." (`inbox.tsx:579-582`).
- **Blockers hit:** none visible; the extra hop is silent.
- **Verdict:** `partial` (step 1: lands on the wrong surface; the next action exists but is one small link).
- **Fix:** return `revision_id` for the active submission in `review_requested` rows and route to `/review/$revisionId`; deep-link data issues, runs and cell conflicts to the specific object.
- **Severity:** S3.

### J-NBK-13 Review returned for changes: author resubmits
- **Persona / goal:** Author whose submission was returned wants to address comments and resubmit.
- **Entry:** `ReturnedCommentsBanner`: "Returned for changes by {name} · {date} · N comments to resolve before you resubmit" (`routes/review/$revisionId.tsx:1047-1100`).
- **Path:**
  1. "Go to comment" focuses the first open thread (`:1076-1080`).
  2. Author can reply and resolve: `canCommentOnRevision` allows `state === 'returned'` (`:320-330`, `:822-826`).
  3. "Resubmit (N open)" is disabled with "Resolve the returned comments first." (`:1080-1090`); at zero open it becomes a link to the notebook (`:1091-1100`).
  4. Returned is not an active review (`notebookReviewActivity` returns `none`, `lib/notebook-experience.ts:60-65`), so the notebook Submit is available again (`notebook.tsx:953-958`).
- **Blockers hit:** the disabled-button reason is tooltip-only (S3 polish).
- **Verdict:** `complete`.
- **Fix:** optionally render the disabled reason as visible text.
- **Severity:** S3.

### J-NBK-14 Edit while offline, reconnect, edits do not sync
- **Persona / goal:** Scientist who edited a block, Sheet row, cell or comment offline and reconnects.
- **Entry:** Notice "Some edits could not sync" (`components/offline/offline-replay.tsx:119-147`), mounted at `routes/records/$recordId/notebook.tsx:747-751`.
- **Path:**
  1. Replay runs once on the transition to live (`offline-replay.tsx:88-117`, `lib/offline/replay.ts:353-361`).
  2. A cell conflict creates a server conflict row, and the Sheet offers "Review first conflict" and the cell panel (`components/sheet/canonical-sheet-workspace.tsx:2094-2110`); that sub-path has a next action.
  3. A stale block-text, row or comment edit gets no conflict row: it is marked a conflict, kept queued, and the Sheet's dependent calculations are held "until it is reviewed" (`lib/offline/replay.ts:331-347`). Nothing in the UI reviews it.
  4. A refused or failed edit "stays queued" (`replay.ts:176-181`). The notice says "N edits were refused and stay queued." and stops (`offline-replay.tsx:139-145`).
  5. The notice has no action. The inspector's Unsynced changes list shows time, kind and a snippet per edit with no Keep / Discard / Retry (`components/offline/unsynced-changes.tsx:233-250`). `removeEdits` is called only on a successful commit (`replay.ts:371`), so a refused edit is never removable by the user and replay never re-runs until the next live transition.
- **Blockers hit:** "1 edit conflicts with a change on the server" / "N edits were refused and stay queued." Neither says which edit, where, or what to do.
- **Verdict:** `dead-end` (steps 3-5) for text, rows, comments and refused edits; `complete` for cell conflicts.
- **Fix:** add per-edit actions in the Unsynced list (Retry now, Copy text, Discard) and a "Review" link on the notice that scrolls to the block or opens the cell conflict; for stale block text, raise the same two-sided conflict banner as autosave.
- **Severity:** S1 (user-authored scientific data stuck on the device indefinitely, with held calculations).

### J-NBK-15 Offline: submit, sign and keep working
- **Persona / goal:** User loses connectivity mid-notebook.
- **Entry:** `OfflineBanner` "You're offline. Keep working: edits are saved on this device and sync when you reconnect." (`components/offline/offline-banner.tsx:60-68`).
- **Path:**
  1. Banner shows pending count, last-synced time and a Retry that asks the coordinator to reconnect (`offline-banner.tsx:69-95`, `components/offline/offline-status.tsx:134-146`).
  2. Submit and Sign stay visible but disabled with the reason beside them: "Submitting needs a connection" / "Signing needs a connection" (`components/offline/connection-required.tsx:19-26`, `:60-68`; `notebook.tsx:1126-1158`).
  3. Block autosave settles into "Offline — will save when reconnected" (`components/notebook/save-status.tsx:44-49`).
  4. Signing out keeps drafts and says so (`components/offline/signed-out-surface.tsx:276-283`).
- **Blockers hit:** none without an action; the cause is named and Retry is offered. What happens after reconnect is J-NBK-14.
- **Verdict:** `complete`.
- **Fix:** none for this journey.
- **Severity:** S3.

### J-NBK-16 Block save conflict versus block save failure
- **Persona / goal:** Author editing a block whose save is rejected.
- **Entry:** the footer under the editor, `AutosaveFooter` (`components/notebook/block-editor.tsx:364-400`).
- **Path:**
  1. Version conflict: red status "Conflict — needs review", a `ConflictBanner` with the server value preview and two buttons "Use server version" / "Keep my edit" (`components/notebook/conflict-banner.tsx:39-86`; wired at e.g. `block-editor.tsx:465-466`). Complete.
  2. Validation failure: "Save failed" plus the list of validation errors, with an Explain affordance (`block-editor.tsx:396-398`).
  3. Transient failure after the retry limit (default 3): status goes to `failed` with the message "Save failed after several attempts." (`components/notebook/use-autosave.ts:350-355`). `AutosaveFooter` renders only the status text in that case; the hook's `retry()` is exposed (`use-autosave.ts:111-114`) but wired only to "Keep my edit" inside the conflict banner (`block-editor.tsx:380-394`). There is no "Try again" and the footer is absolutely positioned over the block corner (`:381`).
  4. The unsaved-work guard then blocks leaving the page and blocks Submit (J-NBK-06 step 3), so the user is pinned with no control to resolve it.
- **Blockers hit:** "Save failed after several attempts."
- **Verdict:** `partial` (conflict: complete; exhausted-retry failure: dead-end at step 3).
- **Fix:** render a "Try again" button when `status === 'failed'` and there are no validation errors, calling the same `retry()`; show the connection state alongside.
- **Severity:** S2.

### J-NBK-17 Open an archived notebook
- **Persona / goal:** Owner who opens an archived notebook and wants to edit it.
- **Entry:** `ArchivedBanner`: "This notebook is archived. It is read-only until restored." (`routes/records/$recordId/notebook.tsx:1486-1500`, mounted `:803`).
- **Path:**
  1. The banner states the cause but names no one who can restore and has no action.
  2. There is no notebook-level restore control in the UI: `restore_record` appears only in the public API contract and pipeline actions (`lib/public-api-rpc-contracts.ts:464`, `lib/pipelines/actions.ts:106`), and a search of `routes`/`components` finds restore only for projects (`routes/projects/$projectId/settings.tsx:340`) and materials.
  3. If the archive came from the project, the banner does not link to the project settings Archived tab (the path that does exist).
  4. Header Submit and Sign are hidden without explanation (`notebook.tsx:953-966`), the template banner is suppressed (`:806`), and comments are disabled (`:3085`).
- **Blockers hit:** exact copy above.
- **Verdict:** `dead-end` (step 1).
- **Fix:** name the cause (archived by whom, via project or record), link to the project's Archived tab when the project is archived, and add a Restore action for roles with `projects:write`; otherwise say "Ask a project owner to restore it".
- **Severity:** S2.

---

## Summary

| ID | Title | Verdict | Severity |
| --- | --- | --- | --- |
| J-NBK-01 | Start a new notebook from a template | dead-end | S1 |
| J-NBK-02 | "New template version" banner on a locked notebook | dead-end | S2 |
| J-NBK-03 | Publish or retire a template version | partial | S2 |
| J-NBK-04 | Open a protocol that needs editing or review | dead-end | S2 |
| J-NBK-05 | Start an experiment against an unacknowledged protocol version | partial | S2 |
| J-NBK-06 | Submit for review from the notebook header | partial | S2 |
| J-NBK-07 | Submit under an authored-signature workflow, not certified | partial | S1 |
| J-NBK-08 | Sign from the notebook, signature not certified | partial | S2 |
| J-NBK-09 | Sign blocked because review checks have not passed | dead-end | S1 |
| J-NBK-10 | Sign dialog with no eligible meaning or expired session | dead-end | S2 |
| J-NBK-11 | Review actions disabled or revision superseded | partial | S2 |
| J-NBK-12 | Reviewer opens an Inbox review item | partial | S3 |
| J-NBK-13 | Review returned for changes: author resubmits | complete | S3 |
| J-NBK-14 | Edit offline, reconnect, edits do not sync | dead-end | S1 |
| J-NBK-15 | Offline: submit, sign and keep working | complete | S3 |
| J-NBK-16 | Block save conflict versus block save failure | partial | S2 |
| J-NBK-17 | Open an archived notebook | dead-end | S2 |

Counts: complete 2, partial 8, dead-end 7. Severity: S1 x4 (01, 07, 09, 14), S2 x10, S3 x3.
