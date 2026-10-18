# Journeys: Samples, Materials and Inventory

Domain: sample registry and detail, lineage, quarantine / hold / release / disposal,
consumed and expired states, storage, labels and scan, materials and lots, aliquots,
chain of custody, empty and project-scoped lists. Format follows `README.md`.

Audited against the working tree on branch `GWP/instrument-parser-journey`
(HEAD `21e11c97`). Every claim was read from code; nothing was run in a browser.
Paths are relative to `src/`.

Standing observations that several journeys rely on:

- `editSample`, `archiveSample`, `restoreSample`, `receiveSample` and `consumeSample`
  exist in `lib/samples.tsx` (lines 1191, 1221, 1384, 1447, 1465) but no route or
  component calls them. A sample can be registered, moved, withdrawn, quarantined,
  released and disposed, and nothing else.
- Hold limits (`holdUntil`, `holdDurationDays`, `holdCondition`) and
  `allowedUseExperimentIds` are read everywhere and written nowhere in the UI. Only
  the seed (`db/seed/design.ts`) and stories set them.
- Release-check rules (`sample_release_rules`) appear only in `db/schema.ts` and the
  SQL; no settings surface edits them.

---

### J-SAM-01 Quarantined sample: "View release basis"
- **Persona / goal:** Scientist or steward who finds a sample in quarantine and needs to know why it cannot be released.
- **Entry:** Sample detail, amber banner "In quarantine since {date}." (`components/v3/samples/sample-state-banner.tsx:28`, copy from `sample-state.ts:183-192`).
- **Path:**
  1. Banner action button "View release basis" (`routes/samples/$sampleId.tsx:348-356`).
  2. The button is `<Link to="/samples/$sampleId" params={params}>`, the page the user is already on. Nothing changes.
  3. The only real "release basis" is the Details tab row `Release basis` (`routes/samples/$sampleId/index.tsx:376`), which reads `—` unless a release has already happened, because `releaseChecks` is only written by `api.release_sample` on success. The Measurements tab is where the checks draw their data (`measurements.tsx`), but nothing links there.
- **Blockers hit:** A control that promises the basis and navigates nowhere. The banner body also gives no check names, thresholds or missing measurements.
- **Verdict:** `fixed` (button opens Measurements; fixed in db323d8e).
- **Fix:** Point the button at the Measurements tab (`/samples/$sampleId/measurements`), and show the evaluated rule list with pass/fail per rule there. If no rules apply, say so.
- **Severity:** S1

### J-SAM-02 Release refused by release checks
- **Persona / goal:** Scientist who has resolved the quarantine reason and presses "Release…".
- **Entry:** Header `Release…` (`$sampleId.tsx:406-413`) opens a notes-only dialog (`$sampleId.tsx:529-537`).
- **Path:**
  1. Confirm. `releaseSample` calls `api.release_sample`, which evaluates the per-type rules against measurement provenance and raises SB093 `release checks failed: [<failedLabels>]` (`drizzle/0282_left_micromacro.sql:608-660`).
  2. `onError` shows a toast from `describeSampleError` (`$sampleId.tsx:190-192`). SB093 is mapped to the fixed text "The release, quarantine or disposal could not be recorded. Check the required details." (`lib/samples.tsx:1571-1572`).
  3. The dialog has a single optional Notes field, so there are no "required details" to check. The failed labels in the SQL message are discarded.
- **Blockers hit:** The refusal never names which check failed, which measurement is missing or where to record it. The same SB093 text is also used for quarantine and disposal.
- **Verdict:** `fixed` (failed checks listed in the release dialog with a link to Measurements; fixed in db323d8e).
- **Fix:** Parse `failedLabels` from the error message, render them in the dialog (or as a banner under the sample header) and link each to the Measurements tab. Split SB093 copy by operation.
- **Severity:** S1

### J-SAM-03 Quarantined sample, user cannot release
- **Persona / goal:** Technician, viewer or other non-releasing role who sees a quarantined sample and needs it released.
- **Entry:** Same banner as J-SAM-01.
- **Path:**
  1. Release is gated on `canReleaseSample(role)` (`sample-state.ts:52-58,71-73`; `$sampleId.tsx:313,317`): owner, admin, steward, scientist, reviewer only.
  2. For any other role the banner action is still "View release basis" (the self-link from J-SAM-01) and the header shows Move / Print only.
- **Blockers hit:** Banner says "Can't be used in experiments until released by an authorised releaser." (`sample-state.ts:191`). It does not say who those people are, and there is no "Ask for release" or notify action.
- **Verdict:** `partial` (cause is named; resolver is not).
- **Fix:** Name the roles ("a steward, scientist or reviewer in this workspace") and link to the workspace members list, or add a "Request release" action that sends an inbox item.
- **Severity:** S2

### J-SAM-04 Hold limit passed or sample expired
- **Persona / goal:** Scientist who wants to use the remaining volume of a past-hold sample, or tidy it up.
- **Entry:** Red banner "Hold limit passed on {date} ({n} days at {condition})." or "Expired on {date}." (`sample-state.ts:195-219`).
- **Path:**
  1. `canWithdrawSample` hides Withdraw for `hold_exceeded` / `expired` (`sample-state.ts:90-98`; `$sampleId.tsx:398-405`).
  2. Banner body: "Remaining volume can't be withdrawn." or "can only be used by N explicitly allowed experiments." (`sample-state.ts:149-153`).
  3. The only action is "Record disposal", shown only for owner, admin, steward, scientist (`$sampleId.tsx:318-320,357-360`). Quarantine is also hidden in these states (`$sampleId.tsx:414-416`).
  4. `release_sample` accepts any non-terminal status, but the UI offers Release only for `quarantined` (`$sampleId.tsx:317`).
- **Blockers hit:** The allowed-experiments exception is described but cannot be edited anywhere in the UI. No way to extend the hold, record a retest, or release after re-qualification. Reviewers and other non-disposing roles get no action at all and no owner named. The hold meter shows "N of N days used" with no word "exceeded" (`sample-hold-meter.tsx:176-183`).
- **Verdict:** `fixed` (Extend hold, editable allowed experiments, Re-qualify; fixed in db323d8e).
- **Fix:** Offer "Extend hold / re-qualify" (edit hold fields with a reason), expose the allowed-use list as an editable field for authorised roles, and for others name who can act.
- **Severity:** S1

### J-SAM-05 Sample with no hold date recorded
- **Persona / goal:** Technician registering a time-limited sample who wants hold-time tracking.
- **Entry:** Detail inspector "Hold time" section: "No hold or expiry date recorded." (`sample-hold-meter.tsx:166-172`); Details tab "Hold limit  —" (`index.tsx:369`).
- **Path:**
  1. The Register sample dialog has Project, Name, Type, Quantity, Unit, Storage location only (`routes/samples.tsx:441-497`).
  2. No Edit action exists on detail (`editSample` is uncalled).
- **Blockers hit:** The empty state states a fact and offers no way to change it. A sample registered through the UI can never gain a hold, so the sweep that produces `hold_exceeded` (`lib/sample-hold.server.ts`) never applies to it.
- **Verdict:** `dead-end` (step 2).
- **Fix:** Add hold condition, start and duration to Register, and an "Edit hold" action in the inspector section.
- **Severity:** S2

### J-SAM-06 Sample not found or not visible
- **Persona / goal:** User following a shared link, bookmark or ID to a sample.
- **Entry:** `/samples/<uuid-or-SMP-id>`.
- **Path:**
  1. `resolveIdentifierParam` redirects display IDs; unresolved IDs fall through (`lib/identifier-resolution.ts:91-102`).
  2. The layout renders only a header: breadcrumb "Samples" and title "Sample not found" (`$sampleId.tsx:295-303`).
- **Blockers hit:** Same screen for a missing ID, an archived or deleted sample, a project the user has no access to, and a failed fetch (`query.isError` is not read). No description, no search, no retry, no mention of project access. Contrast `/r/$identifier`, which offers "Search for the record" and "Try again" (`routes/r/$identifier.tsx:46-77`).
- **Verdict:** `dead-end` (step 2).
- **Fix:** Use an `EmptyState` that distinguishes error (Retry) from not-found, names project access as a cause (`NO_PROJECT_ACCESS_BODY`), and links to Search and to the registry.
- **Severity:** S2

### J-SAM-07 Withdraw button disabled
- **Persona / goal:** Scientist withdrawing volume for an experiment.
- **Entry:** `Withdraw volume…` on an available sample (`$sampleId.tsx:398-405`, or Usage tab `usage.tsx:259-265`).
- **Path:**
  1. Dialog requires a Purpose experiment (`withdraw-dialog.tsx:344,419-435`). Options are the 100 most recent active experiments in the whole workspace (`withdraw-dialog.tsx:147`), not scoped to the sample's project.
  2. If none exist the select shows "No experiments available" and the Withdraw button stays disabled with no explanation and no link to create one.
  3. A fully reserved sample (free = 0) behaves the same: the field error appears only after a number is typed (`withdraw-dialog.tsx:67-86`); until then the button is silently disabled.
  4. A sample past its hold limit loses the button entirely (J-SAM-04).
- **Blockers hit:** Disabled primary action with no stated cause. An experiment older than the 100 newest cannot be picked at all.
- **Verdict:** `partial` (step 2: disabled without reason).
- **Fix:** When `experiments` is empty or `free <= 0`, show a one-line reason above the footer with a link to New experiment or to the Usage tab's reservations. Add search to the Purpose select.
- **Severity:** S2

### J-SAM-08 Aliquot, derive or split a sample
- **Persona / goal:** Scientist who needs to aliquot a vial into child tubes with their own labels.
- **Entry:** Dialog field "Into: New container, print label" in the withdraw dialog (`withdraw-dialog.tsx:437-455`).
- **Path:**
  1. The only creation path for a derived sample is a withdrawal with `newContainer`, which needs an experiment as purpose.
  2. On success: toast "Volume withdrawn and container created" (`$sampleId.tsx:205-213`). No link to the child, no label print, although the option text says "print label".
  3. The Lineage tab will list the child (`lineage.tsx:114-169`). Printing means opening the child and pressing Print label.
- **Blockers hit:** No standalone aliquot or split action; a multi-aliquot split means repeating the dialog. No bulk label print. Lineage empty state "No lineage links yet" offers nothing to create a link (`lineage.tsx:162-169`).
- **Verdict:** `partial` (step 2: result not linked, label promise unfulfilled).
- **Fix:** After success, toast action "Open {child id}" or open the child's print dialog. Add a "Split into N aliquots" action.
- **Severity:** S2

### J-SAM-09 Registry tab is empty
- **Persona / goal:** Steward checking Quarantine, Reserved or Consumed tabs.
- **Entry:** `/samples?tab=quarantine` (and others) with no matching rows.
- **Path:**
  1. Empty state title "No samples in quarantine" with description "Register a sample or import a plate map to start the registry." (`routes/samples.tsx:308-321`). The description is the same for every tab.
  2. Action button is "Back to in stock", a link to `/samples?tab=<current tab>` (`samples.tsx:322-334`). On the In stock tab that is the same URL.
  3. In stock also contains quarantined, hold-exceeded and expired samples (`samples-data.ts:70-74`); only quarantined has its own tab.
- **Blockers hit:** Misleading "start the registry" copy on a tab where an empty list is good news; the button is a no-op on In stock; Disposed samples fold into Consumed (`samples-data.ts:64-69`) so the tab label hides them. No tab or filter exists for hold-exceeded or expired.
- **Verdict:** `partial` (steps 1-2).
- **Fix:** Per-tab copy ("Nothing is in quarantine"), button only when the tab is not In stock, and add Hold exceeded / Expired tabs (or status filter).
- **Severity:** S3

### J-SAM-10 Registry larger than 200 samples
- **Persona / goal:** Technician looking for sample SMP-0301 by ID or name.
- **Entry:** `/samples`, search box "Search by ID, name, location".
- **Path:**
  1. `useSamplePage` fetches one page: `pageSize: 200`, order `identifier.asc`, no loop (`samples-data.ts:26-32,97-103`; `lib/samples.tsx:448-457`). Materials, by contrast, loops until exhausted (`materials-data.ts:204-219`).
  2. Search and tab filtering run in memory on those rows (`samples.tsx:122-132`). Tab counts and the footer "x of y" are also computed from the 200 (`samples.tsx:119-121,339-341`), while the header total is the server count (`samples.tsx:222`).
  3. Sample 201 onward is invisible; searching for it yields "No samples match “…”" and "Search looks at ID, name, type and location." (`samples.tsx:312-319`).
- **Blockers hit:** False negative on search in a regulated registry, with a header total that contradicts the footer. The only escape is Scan or the project Samples tab.
- **Verdict:** `fixed` (registry reads every page; fixed in SHA10).
- **Fix:** Page through all rows like materials, or move search and tab predicates server-side. Until then show "Showing first 200 of N" with a link to the project tab.
- **Severity:** S1

### J-SAM-11 Register sample: no project, or the write fails
- **Persona / goal:** New user registering the first sample.
- **Entry:** `Register sample` (header, shell command at `components/v3/shell/app-shell.tsx:607`, empty state).
- **Path:**
  1. Project is a required select fed by `useProjectNames` (`samples.tsx:445-457`). A user with no project access gets only "Choose…".
  2. The primary button is disabled while `!projectId` (`samples.tsx:503`) with no message. The list-level no-access copy (`samples.tsx:316-318`) is not repeated in the dialog.
  3. The `create` mutation has no `onError` (`samples.tsx:188-215`). A permission or version error leaves the dialog open with the button re-enabled and nothing said.
  4. Duplicate or invalid input (negative or non-numeric quantity, free-text unit) has no inline validation.
- **Blockers hit:** Silent disabled button; silent failure.
- **Verdict:** `dead-end` (steps 2-3).
- **Fix:** When the project list is empty, replace the dialog body with the no-access message and a link to Settings → Access. Add `onError` using `describeSampleError` and inline field errors.
- **Severity:** S2

### J-SAM-12 Scan: code not found
- **Persona / goal:** Technician scanning a tube whose label is unknown to the system.
- **Entry:** `/scan` (Scan label button on Samples and Materials).
- **Path:**
  1. Miss: warning "No record with ID {code}." with "Did you mean …?" suggestions, or "Check the label and try again." (`routes/scan.tsx:114-139`).
  2. Hit with several exact matches: only the first is shown; `suggestions` are dropped (`scan-data.ts:155-162` versus `scan.tsx:82-112`).
  3. Hit on a material lot: opens `/records/$recordId`, not `/materials` (`scan-data.ts:64-75,97-112`; "Open record").
  4. Hit on a quarantined or expired sample shows only a status chip; the primary button is the same "Open sample" (`scan.tsx:101-110`).
- **Blockers hit:** No "Register this sample" or "Search" action on a miss; lookup is exact then substring on identifier or alias only (title and lot are not searched). Hit status chips do not warn "do not use".
- **Verdict:** `partial` (step 1: advice without an action).
- **Fix:** Add "Register sample with ID {code}" and "Search all records" to the miss notice; render a warn notice on hit when the status is quarantined / hold_exceeded / expired; route material hits to `/materials?selected=`.
- **Severity:** S2

### J-SAM-13 Printed label QR code scanned outside the app
- **Persona / goal:** Technician scanning the printed label with a phone camera before using the sample.
- **Entry:** QR payload `https://<host>/r/<identifier>` (`components/v3/samples/sample-label-card.tsx:12,73`).
- **Path:**
  1. `/r/$identifier` resolves the record then always navigates to `/records/$recordId` (`routes/r/$identifier.tsx:35-42`).
  2. `records/$recordId/index.tsx:6-13` redirects to `/records/$recordId/notebook`. For a sample that is the generic notebook page with a sample side-panel whose only status line is the raw `status` string (`routes/records/$recordId/notebook.tsx:457-480`).
  3. No route redirects a sample record to `/samples/$sampleId`.
- **Blockers hit:** The page header comment promises landing "on the object the label names"; for a sample the user misses the quarantine / hold banner, the withdraw action and the hold meter, and gets no link to the sample page. The scan-time warning that matters most is absent where the label sends people.
- **Verdict:** `fixed` (QR route now sends samples to `/samples/<id>`; fixed in 68dab8c4).
- **Fix:** In the `/r` route use `recordDestination(kind, id)` (`lib/navigation.ts:42`) or add a record-layout redirect for `kind = sample | material`.
- **Severity:** S1

### J-SAM-14 "Open" from a lineage row, notebook material block, inbox or home
- **Persona / goal:** User following a link to a child sample or an expiring lot.
- **Entry:** Lineage row title (`lineage.tsx:143-146`), notebook material "Open" (`components/notebook/block-preview.tsx:560-565`), inbox `material_expiring` (`routes/inbox.tsx:151`), home "Open lot" (`lib/home-quiet.ts:90-94`).
- **Path:**
  1. Destinations come from `recordDestination`, which returns `/samples?selected=<id>` and `/materials?selected=<id>` (`lib/navigation.ts:30-37,42-48`). These are registry lists, not the detail page.
  2. The registry applies `selected` only inside the active tab's visible rows, else falls back to the first row (`samples.tsx:133-135`; `materials.tsx:190-192`). Default tab is In stock.
  3. A consumed or disposed sample lives on the Consumed tab (`samples-data.ts:64-69`); an expired or quarantined lot lives on its own tab (`materials-data.ts:153-158`). `selected` does not carry a tab.
  4. Inbox sends `/materials` with no `selected` at all.
- **Blockers hit:** The user lands on the wrong item's inspector with no sign the link failed. For an expired lot, the exact case the notification is about, the lot is not visible.
- **Verdict:** `dead-end` (step 3: silent mis-selection).
- **Fix:** Send samples to `/samples/$sampleId`. In the registries, when `selected` is outside the active tab, switch to the tab that contains it. Pass `recordId` in the inbox link.
- **Severity:** S2

### J-SAM-15 Materials registry empty or lot cannot be received
- **Persona / goal:** Steward setting up inventory, or a user with no project access.
- **Entry:** `/materials` with no lots in the current tab or in total.
- **Path:**
  1. Header actions are only "Scan label" and `Receive lot`, and Receive is `disabled={!sel}` (`materials.tsx:354-368`). With no lots there is nothing to select, so it is permanently disabled, with no tooltip.
  2. Receive adds stock to the selected lot (`materials.tsx:325-344`); there is no "Register material" or import anywhere in the route.
  3. Empty state: "No lots in in stock" and "Lots appear here when their status or expiry puts them in this list." with a "Back to in stock" button that is a self-link on that tab (`materials.tsx:433-458`). Unlike samples it has no `useHasProjectAccess` branch, so a user who cannot see any project gets the same text.
- **Blockers hit:** A new workspace cannot create its first lot from this page. Title grammar ("No lots in in stock"). No access explanation.
- **Verdict:** `dead-end` (step 1-2).
- **Fix:** Add a "Register material lot" primary action that does not depend on selection, reuse the project-access empty state, and fix the copy.
- **Severity:** S1

### J-SAM-16 Quarantine a lot, then restore it
- **Persona / goal:** Steward isolating a suspect reagent lot and later reinstating it.
- **Entry:** Inspector `Quarantine` / `Restore` (`materials.tsx:490-508`).
- **Path:**
  1. Quarantine opens a confirm with an optional reason (`materials.tsx:636-661`).
  2. The lot moves to the Quarantine tab (`materials-data.ts:155`). The inspector shows only `expiryNote` (null for a lot not near expiry) so the lot's detail has no quarantined banner or reason (no `quarantineReason` reference in `materials.tsx` or `materials-data.ts`).
  3. `Restore` runs immediately with no confirm, no reason, and no role check (`materials.tsx:260-277,490-498`), unlike samples, where release is role-gated and check-gated.
  4. Errors surface as raw `error.message` toasts (`materials.tsx:255-257,274-276`).
- **Blockers hit:** Another user opening a quarantined lot cannot see why or since when. Restoring a lot that is past expiry puts it in the Expired tab with no further guidance.
- **Verdict:** `partial` (step 2: reason invisible; step 3: ungoverned exit).
- **Fix:** Show a quarantine banner (reason, who, when) in the inspector, make the reason required, and require a note or role for Restore.
- **Severity:** S2

### J-SAM-17 Withdraw volume from an available sample (control)
- **Persona / goal:** Scientist consuming 50 µL of an available aliquot for an experiment.
- **Entry:** Sample detail, `Withdraw volume…` (`$sampleId.tsx:398-405`).
- **Path:**
  1. Dialog shows available volume in the header and a Volume field with live "N will be left" or "Only X left. Enter X or less." (`withdraw-dialog.tsx:67-86,379-392`). Unit is locked to the balance unit (`withdraw-dialog.tsx:325,406`).
  2. Choose Purpose experiment, optionally Into a new container; Withdraw is enabled when valid.
  3. Server errors map to actionable text: SB006 states the amount actually free, SB001 says refresh, SB004 and 42501 explain the state or permission (`withdraw-dialog.tsx:94-123`).
  4. Success invalidates the sample, events, balances and reservations; the Usage tab, History tab and "Recent history" update (`$sampleId.tsx:178-189,205-213`).
- **Blockers hit:** None on the happy path; the disabled-state gaps are J-SAM-07.
- **Verdict:** `complete`
- **Fix:** None for this path.
- **Severity:** S3

---

## Additional observations (not counted as journeys)

- Low stock is computed (`materials-data.ts:179-186`) but `routes/materials.tsx` never renders `attention`; there is no Low stock tab, chip or inspector line. The protocol material block does flag "Low stock" with no way to act except Open, which hits J-SAM-14.
- Registering a replacement lot (`materials.tsx:279-309`) validates inline and is otherwise sound, but only invalidates the list; the "No replacement lot" inspector section for the old lot uses a separate query that stays stale (`materials.tsx:311-316`), and the new lot is not selected.
- Terminal samples (consumed, disposed) show Export lineage only and hide the inspector (`$sampleId.tsx:392-393,482`); the Usage tab still offers `Reserve volume…` (`usage.tsx:256`), which the server will refuse.
- Move uses a free-text location dialog with no existing-location picker (`$sampleId.tsx:521-528,566-610`); SB007 "already at that location" is only reported after submit.
- Mobile: header actions are `max-md:hidden` (`$sampleId.tsx:391`), so Move, Release, Quarantine and Print are not reachable on a phone; the Usage tab exposes only Reserve / Withdraw there.
- The "Used in" list on a lot shows plain identifiers, not links (`materials.tsx:567-577`).

## Summary

| ID | Title | Verdict | Severity |
| --- | --- | --- | --- |
| J-SAM-01 | Quarantined sample: "View release basis" | dead-end | S1 |
| J-SAM-02 | Release refused by release checks | dead-end | S1 |
| J-SAM-03 | Quarantined sample, user cannot release | partial | S2 |
| J-SAM-04 | Hold limit passed or sample expired | dead-end | S1 |
| J-SAM-05 | Sample with no hold date recorded | dead-end | S2 |
| J-SAM-06 | Sample not found or not visible | dead-end | S2 |
| J-SAM-07 | Withdraw button disabled | partial | S2 |
| J-SAM-08 | Aliquot, derive or split a sample | partial | S2 |
| J-SAM-09 | Registry tab is empty | partial | S3 |
| J-SAM-10 | Registry larger than 200 samples | dead-end | S1 |
| J-SAM-11 | Register sample: no project, or the write fails | dead-end | S2 |
| J-SAM-12 | Scan: code not found | partial | S2 |
| J-SAM-13 | Printed label QR code scanned outside the app | dead-end | S1 |
| J-SAM-14 | "Open" from lineage, notebook, inbox or home | dead-end | S2 |
| J-SAM-15 | Materials registry empty or lot cannot be received | dead-end | S1 |
| J-SAM-16 | Quarantine a lot, then restore it | partial | S2 |
| J-SAM-17 | Withdraw volume from an available sample (control) | complete | S3 |

Verdict counts: dead-end 9, partial 7, complete 1.
