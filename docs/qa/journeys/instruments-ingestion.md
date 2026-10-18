# Journeys: instruments and ingestion (J-INS)

Traced from the code on branch `GWP/instrument-parser-journey` (which includes the
parser follow-up fix in `parser-follow-up.tsx`). Paths are `file:line` as read; where a
claim rests on SQL or on the absence of a route rather than on UI code, the journey says so.
Format and severity scale are in [README.md](./README.md).

Not run in a browser. Verdicts describe what the code offers, not what a tester saw.

### J-INS-01 Automated instrument has no validated parser (reference journey)
- **Persona / goal:** lab scientist or schema editor who registered a file-drop or webhook instrument and wants its readings to import into a GxP dataset.
- **Entry:** warning on the registry inspector or the instrument record: "No parser yet." / "Parser not validated."
- **Path:**
  1. `parserFollowUp()` returns `missing` (no parser) or `draft` (newest draft version id) and `null` once any version is non-draft (`instruments-data.ts:308-324`). It stays quiet while parsers are still loading (`:313`).
  2. `ParserFollowUpNotice` names the instrument, the cause and the consequence, and shows one button, "Add a parser" or "Validate the parser" (`parser-follow-up.tsx:7-19`, `:37-56`). It is rendered in the inspector (`instruments.tsx:788-794`) and on the record page (`$instrumentId.tsx:486-491`).
  3. The button opens `/settings/instruments?instrumentId=…&versionId=…`. `ParserSettings` shows "Setting up the parser for <instrument link>" with state-aware guidance (`parser-settings.tsx:168-180`, `:35-47`), prefills the draft name and key (`:95-104`) and preselects the draft version (`:75`).
  4. Create draft, pick or upload a retained file, validate, approve (`parser-settings.tsx:117-155`, `:211-268`).
- **Blockers hit:** a user without `schema.edit` gets no button. The notice adds "Ask a workspace admin or schema editor to set this up." (`parser-follow-up.tsx:55`). The inspector also has a "Parser and imports" link (`instruments.tsx:816-824`).
- **Verdict:** `complete`. Cause, consequence and next step are all present, and a viewer is told who can act.
- **Fix:** none. Known limit: the warning clears at "validated", not "approved" (see J-INS-02).
- **Severity:** n/a

### J-INS-02 Parser is validated but not approved; the GxP import is then refused
- **Persona / goal:** schema editor who has just validated a parser and sees the warning disappear.
- **Entry:** the instrument inspector reads "Parser: X · validated" with no notice. Later, the import commit fails for a regulated dataset.
- **Path:**
  1. `validated` means `version.status !== 'draft'`, so `validated` and `approved` both count (`instruments-data.ts:288`, `:417`). `parserFollowUp()` therefore returns `null` and the inspector shows no further step (`:314`).
  2. A regulated dataset needs an approved version (`parser-settings.tsx:183`).
  3. On commit the server raises SB107. It records the failure as "The regulated Dataset requires an approved matching parser version. Validate and approve this version before retrying." (`src/lib/import/server.ts:81-95`).
  4. The import page shows that text in the "Import error" banner (`import-flow.tsx:842-851`). The banner's only action is "Ask admin to update parser".
- **Blockers hit:** the registry states the parser is ready while the import refuses it. The `/settings/instruments` page does hold the Approve button (`parser-settings.tsx:259-267`). No instrument surface leads there once the follow-up has cleared. The banner offers "Ask admin" even when the person is the admin.
- **Verdict:** `partial`. The next step exists but is reachable only by remembering it. The registry's "ready" signal contradicts the import gate.
- **Fix:** add a third follow-up kind, `validated`, titled "Awaiting QA approval" with an "Approve the parser" link to `/settings/instruments?versionId=…`. Or compute `validated` from `approved` for GxP datasets.
- **Severity:** S2

### J-INS-03 Validate and approve a parser in settings: failure and disabled controls
- **Persona / goal:** schema editor or steward testing a draft against a retained export.
- **Entry:** `/settings/instruments` with a draft version selected.
- **Path:**
  1. "Validate retained file" is disabled until a file is chosen, and also when the status is not draft or validated (`parser-settings.tsx:247-257`). No text says which condition applies.
  2. The file list is the 100 most recent workspace files, labelled `filename · id8`, with no instrument filter (`parser-settings.ts:86-100`, `parser-settings.tsx:211-223`). The upload control appears only for editors (`:224-230`).
  3. A failed validation reads `Validation failed: <errors joined by ;>` (`:142-146`). Nothing points to the definition fields or to creating a new version.
  4. "Approve version" is disabled until the status is `validated` (`:259-267`), again without a reason.
  5. A malformed JSON signature or mapping surfaces the raw `JSON.parse` message in the page-level alert (`:133-134`, `:382-386`).
- **Blockers hit:** silently disabled buttons and raw failure text. The guidance is good only when arriving from an instrument.
- **Verdict:** `partial`. A route forward exists (edit the JSON, create the next version, re-validate), but nothing says so.
- **Fix:** hint text on each disabled button ("Choose a retained file first", "Validate first, then approve"). After a failed validation add "Fix the signature or mapping and create version N+1 below". Catch `SyntaxError` and name the field.
- **Severity:** S2

### J-INS-04 Member follows a "Parser failure" inbox item to parser settings
- **Persona / goal:** the scientist who uploaded a file that failed. As the file's creator they receive a data-issue work item.
- **Entry:** Inbox "Data issues" row "Parser failure: <file>".
- **Path:**
  1. The view includes the item for owner, admin or steward, and for the file's creator (`drizzle/0311_dset_parser_validation_authority.sql:148-156`).
  2. The Open link goes to `/settings/instruments?fileId=…&versionId=…` (`inbox.tsx:140-146`).
  3. `ParserSettings` shows the "Setting up the parser for…" guidance only when `instrumentId` is present (`parser-settings.tsx:168-180`). That param is not set on this path.
  4. A member without `schema.edit` sees no Validate, Upload, Approve or Create controls (`:224`, `:247`, `:259`, `:307`). The retained file's `parser_failure.message` and "Admin update requested" are shown (`:238-245`).
- **Blockers hit:** a page of read-only tables. It does not say what to do, who can fix the parser, or whether an admin has already been asked (it shows that only if the file is in the list).
- **Verdict:** `dead-end` for a non-governed role. The failure is named but there is no next action and no person. **Status: fixed in 96098c5c.**
- **Fix:** when `fileId` is present and `!canEdit`, show the same `instrumentGuidance` notice ("Ask a workspace admin or schema editor…", plus the `requestedAt` state). Name the admins' inbox as the place the request lands.
- **Severity:** S2

### J-INS-05 Uploaded file is not recognised by any parser
- **Persona / goal:** scientist importing an instrument export into a dataset.
- **Entry:** `/import/<fileId>?step=map` with the banner "Choose how to read this file".
- **Path:**
  1. The server finds no approved parser and records a `parser_unrecognised` failure (`src/lib/import/server.ts:513-520`). The message lists the found headers and names the draft parsers that exist and are not used until approved (`:547-566`).
  2. The page offers "Map columns by hand for this file", "Try parser <draft> (draft)", "Ask an admin to update the parser" and, when parsing failed outright, "Start a different import" (`import-flow.tsx:970-1008`, `:927-962`).
  3. "Ask an admin" records the request, then navigates the requester to `/settings/instruments?fileId=…` (`:729-746`). A non-editor lands in the dead-end of J-INS-04.
- **Blockers hit:** none that stop the work. The manual mapping path always exists. The admin route gives no confirmation of who was asked.
- **Verdict:** `partial`. The user always has a next action, but the "ask admin" button ends on a page that can't act for them.
- **Fix:** after a successful request show a toast or inline status ("Request sent to workspace admins; the file is kept") and stay on the import page for non-editors.
- **Severity:** S3

### J-INS-06 Admin approves a parser; the original import is never resumed
- **Persona / goal:** admin or steward who approved a parser after a failure, expecting the scientist's file to import.
- **Entry:** the success line "Parser version approved. Retry the retained import using this exact version." (`parser-settings.tsx:149-152`).
- **Path:**
  1. The settings page knows `fileId` (`parser-settings.tsx:52-58`, `:76`) but never links to `/import/$importId`.
  2. The resume route exists (`import.$importId.tsx:50-61`) and the dataset Imports tab links to it (`dataset-imports-tab.tsx:163-171`). Nothing on the settings page or in the inbox uses it.
  3. The failure work item clears only when an import commits (`0311…sql:124-136`).
- **Blockers hit:** the page instructs "Retry the retained import" with no control. The admin has to find the file, or ask the scientist, to reopen it.
- **Verdict:** `dead-end` at the final step. The instruction exists but the action does not. **Status: fixed in 96098c5c.**
- **Fix:** when `fileId` is set, render "Resume the import" linking to `/import/$fileId?step=map&parser=<key>`. Also add a "Retry" link on the Inbox item for the creator once the parser is approved.
- **Severity:** S2

### J-INS-07 Review or commit refuses the import
- **Persona / goal:** scientist at the Review step of an import.
- **Entry:** the "These rows stop the import" banner, or the "Import error" banner after Import.
- **Path:**
  1. Row errors list the first 8 rows with copy that offers "Back to mapping" or "store it again" (`import-flow.tsx:1202-1217`). "Back to mapping" is a header button (`:811-816`). "Store it again" has no link.
  2. The Import button is disabled while errors exist (`:817-827`).
  3. A commit failure shows `errors[0].message`. For unmapped codes `describeImportRpcCode` returns the raw code (`import-commit.ts:222-238`). A stale dataset says "Refresh and try again" with no refresh control (`:232-234`).
  4. Every error banner carries "Ask admin to update parser" (`import-flow.tsx:845-849`), including non-parser errors. `request_parser_update` then refuses with "an authoritative parser failure is required" unless a parser failure exists (`0311…sql:113-114`).
  5. After a successful commit the Import button stays enabled and the idempotency key makes a repeat harmless (`:698-702`).
- **Blockers hit:** raw codes, a wrong-context admin action, and no way to retry a stale revision except reloading.
- **Verdict:** `partial`. The mapping route works. The commit-failure copy and actions are generic.
- **Fix:** show the admin button only for parser failure codes. Map the remaining RPC codes to sentences. Add a "Reload dataset" action to the stale message. Add a link back to `/import` in the row-error banner. Replace the Import button with "Open the Dataset snapshots" after success.
- **Severity:** S2

### J-INS-08 Import against an instrument whose calibration is overdue
- **Persona / goal:** scientist importing results and tagging the instrument that produced them.
- **Entry:** the Instrument field on `/import`, which shows a status chip beside the picker.
- **Path:**
  1. The chip reads `calibrationStatus()`: "Overdue", "Due soon", "Valid" or "Not calibrated" (`import-flow.tsx:276-279`, `:467-469`; `instruments-data.ts:600-611`).
  2. The registry says data from an overdue instrument "is flagged and can't be cited in GxP records until a new certificate is attached" (`instruments.tsx:783-787`).
  3. The import path has no calibration check (`grep -i calibrat src/lib/import*` found nothing) and `commit_dataset_import` receives `p_instrument_id` without one (`server.ts:1119-1133`).
- **Blockers hit:** the import proceeds with a red chip and no statement of what that means for the data. There is no link to the instrument or its calibration.
- **Verdict:** `partial`. Nothing blocks, but the consequence the registry promises is never explained here or enforced in the import flow I read.
- **Fix:** under an "Overdue" chip add the registry's sentence plus a link to `/instruments/$id`. If the flag is real, say where it is applied (receipt, dataset flag). If it is not, change the registry copy.
- **Severity:** S2

### J-INS-09 Automated instrument is not delivering data (failed, stale, waiting)
- **Persona / goal:** instrument owner whose file-drop or webhook instrument shows "Last import failed", "No data for N days" or "Waiting for first data".
- **Entry:** registry column or inspector Health row; record page Health badge.
- **Path:**
  1. `intakeHealth()` produces the label and tone (`instruments-data.ts:117-137`). `useInstrumentLastImport` keeps only status and date, not the file or import id (`:237-257`).
  2. The inspector and record page show the label in a description list and badge (`instruments.tsx:795-815`, `$instrumentId.tsx:465-485`). There is no Notice and no link for these states. Only the parser follow-up has one.
  3. For `filedrop` and `webhook` nothing on the instrument says where to drop files or post. The registration toast says "before its posts can import" (`instruments.tsx:970-979`). No ingest route is under `src/routes/api` (only `import`, `connectors.source`, `files`, `pipelines`). Browser upload at `/import` is the only intake I found. The upload page cannot be opened with the instrument preselected (`import.index.tsx`, no `validateSearch`).
- **Blockers hit:** the state is named but no cause, owner or action. For "waiting for first data" the user is not told how data is supposed to arrive.
- **Verdict:** `dead-end`. This is an inference from the code read. If an external agent posts to `/api/db`, it is not documented in the UI. **Status: fixed in 5740cc40.**
- **Fix:** for `failed`, link the last import (file id and dataset) and offer retry. For stale or waiting, link to `/import?instrument=<id>` and state the intake endpoint, or say plainly that this deployment imports by upload. Add `instrument` to the `/import/` search.
- **Severity:** S2

### J-INS-10 Calibration overdue: "until a new certificate is attached"
- **Persona / goal:** instrument owner or technician who must restore a GxP-citable instrument.
- **Entry:** the red Notice "Calibration overdue." in the inspector (`instruments.tsx:783-787`), or the "Calibration due" column.
- **Path:**
  1. The notice has no action. The only route is "Open record" at the top of the inspector (`:755-767`).
  2. The inspector's Calibration section says "Certificates and history are on the record." (`:876-878`).
  3. On the record page, "Record calibration" appears only for `record.create` holders (`$instrumentId.tsx:451-459`). The dialog takes performed, due and notes only (`:611-649`).
  4. `recordInstrumentCalibration` accepts `certificateFileId` (`instruments-data.ts:631-650`), but no UI passes it. No certificate upload or link exists in the instrument UI (`grep certificate` finds only materials and signatures).
  5. The record page shows no overdue notice at all. A user with no create right sees "No calibration recorded…" (`:525-528`) and no one named.
  6. The Calibration tab lists only overdue or soon instruments. A never-calibrated instrument ("Not calibrated") is excluded (`instruments.tsx:146-149`, `:205-214`, `:226-231`).
- **Blockers hit:** the notice promises a certificate that the UI cannot attach. The fix path is two clicks away with no signpost, and a viewer is not told who to ask.
- **Verdict:** `dead-end` at "attach a certificate". **Status: fixed in 98a92cb4.**
- **Fix:** add an action "Record calibration" in the notice (deep link `?record=1`), a certificate upload in the dialog bound to `certificateFileId`, and an overdue notice on the record page. For non-recorders, name the roles that can record. Include `na` instruments in the Calibration tab.
- **Severity:** S1

### J-INS-11 Booking refused: not qualified, or calibration overdue
- **Persona / goal:** scientist booking an instrument from the Schedule or the registry "Book" button.
- **Entry:** the red alert in the "Book an instrument" dialog.
- **Path:**
  1. The dialog does not pre-filter and shows the server's reason (`book-dialog.tsx:94-98`, `:205-209`).
  2. `describeCalendarError` maps SB001 to SB024 and 42501 only. SB115 and SB116 fall through to the raw `error.message` (`calendar.ts:543-560`). The text comes from SQL: "a current qualification is required to book this instrument" or "the instrument calibration is overdue" (`drizzle/0430…sql:216`, `:221`).
  3. There is no link to the instrument record and no person named. Only a workspace owner can grant a qualification (`$instrumentId.tsx:130-131`, `:582-585`), and that fact is written on the record page, not in the dialog.
  4. The instrument picker offers every non-retired instrument, including ones already overdue (`schedule-data.ts:78-92`).
- **Blockers hit:** the cause is named, but there is no owner and no action.
- **Verdict:** `dead-end`. The user must know to open the instrument record and ask a workspace owner. **Status: fixed in ccb6a1fe.**
- **Fix:** map SB115 to "You are not qualified to run <instrument>. A workspace owner can grant this on the instrument record." with a link. Map SB116 to "<instrument>'s calibration is overdue." with a link to Record calibration. Keep the server as the authority.
- **Severity:** S1

### J-INS-12 Recalibrated instrument still refuses bookings (suspected defect)
- **Persona / goal:** technician who has just recorded a new calibration for an instrument that was overdue.
- **Entry:** record page shows "Valid", then booking fails with "the instrument calibration is overdue".
- **Path:**
  1. The UI takes status from the latest calibration by `performed_at` (`instruments-data.ts:714-731`, `$instrumentId.tsx:128`, `:420`).
  2. The booking guard checks `EXISTS (… c.due_at IS NOT NULL AND c.due_at < now())` over every calibration row for the instrument (`drizzle/0430_booking_subject_is_the_instrument.sql:217-222`, and the same guard at `:246-252`). It does not restrict to the latest row.
  3. The DB test named "refuses … when the latest calibration is overdue" updates the only calibration row, so it cannot show the difference (`tests/db/booking-instrument-checks.test.ts:220-232`).
- **Blockers hit:** if the SQL is as written, any instrument with a past calibration whose due date has lapsed stays unbookable after recalibration. The UI and the booking dialog then disagree, and nothing on screen explains it.
- **Verdict:** `dead-end` (suspected). Not reproduced. Confirm with a two-row DB test before treating it as fact. **Status: confirmed by a two-row DB test (`it.fails` in `tests/db/booking-instrument-checks.test.ts`, SB116 raised). Needs backend: a migration restricting the guard in `internal.assert_instrument_bookable` to the latest calibration by `performed_at`; then change `it.fails` to `it`.**
- **Fix:** restrict the guard to the latest row by `performed_at`, to match `latestCalibrationByInstrument`. Add a two-calibration test.
- **Severity:** S1 if confirmed

### J-INS-13 Enterprise connector registered but never configured
- **Persona / goal:** steward connecting an S3 bucket or an external PostgreSQL source.
- **Entry:** Settings → Integrations → Register connector, then the connector page.
- **Path:**
  1. The dialog says bucket, prefix or host settings "are configured on the connector after registration" (`register-connector-dialog.tsx:148-152`). The dialog defaults the adapter to "None (custom)" (`:48`, `:165`).
  2. The detail page's Configuration section is read-only text (`$connectorId.tsx:327-342`). `updateConnector` is called only for status (`:58`, `client.ts:40-57`). I found no config editor in `src/`.
  3. With adapter `s3` or `postgres`, "Test connection" and "List objects" fail with "Configure a valid bucket name on this connector." or "Configure the source host on this connector." (`config-validation.ts:22-25`, `:70-73`).
  4. Missing credentials fail with "…missing required credentials: …. A steward must set them." (`secrets.server.ts:54-56`). The Credentials card shows "Missing required: …" but only to managers (`credentials-card.tsx:75-92`, `:77-79`). Delete has no confirmation or error display (`:60-70`, `:107-115`).
- **Blockers hit:** the error tells the user to configure something the UI offers no way to configure.
- **Verdict:** `dead-end` at configuration. **Status: fixed in 4be60557.**
- **Fix:** add a config form (bucket, prefix, host, port, database, sslMode) bound to `updateConnector({config})`, with "Configure" linked from the validation error. Prefill the credential names from `Missing required`.
- **Severity:** S1

### J-INS-14 Connector is paused, archived, or the viewer cannot run it
- **Persona / goal:** user who opens a connector to ingest or import from it.
- **Entry:** `/settings/integrations/<id>`.
- **Path:**
  1. The Ingest and Source panels render only when `status === 'active'` (`$connectorId.tsx:344-359`). A paused or archived connector shows the header status chip and no explanation of the missing panels.
  2. The Activate button appears only to `integrations.manage` holders, and not for archived connectors (`:292-313`). A viewer sees neither the panels nor a reason.
  3. When the panels do render, every role sees live buttons. Non-executors (not owner, admin or steward) are refused on click with "Your workspace role cannot execute integrations." (`execution.server.ts:31-34`, `:135-139`).
  4. A missing connector shows a bare "Connector" header with no message when the query returns nothing without an error (`:250-269`).
  5. The list page says who can register (`integrations.tsx:165-169`). The empty state has no action for non-managers (`:150-158`).
- **Blockers hit:** panels vanish silently. Refusals come after the click.
- **Verdict:** `partial`. The roles are named on the list page and in the refusal copy, but the detail page gives no state-aware hint.
- **Fix:** when paused or archived, render a Notice ("Paused. Ingest is unavailable. <Activate> / ask an admin or steward"). Disable run buttons for non-executors with the role named. Show "Connector not found" with a link back.
- **Severity:** S2

### J-INS-15 Ingest an instrument file from the connector: disabled button and silent parse failure
- **Persona / goal:** steward or admin pushing a plate-reader CSV through an instrument connector.
- **Entry:** "Ingest instrument output" panel (`ingest-panel.tsx:232-371`).
- **Path:**
  1. "Retain + ingest into Dataset" is disabled until file, schema, project and a dataset or new name are set (`:353-367`). No text says which is missing.
  2. The project select shows only "Select a project…" if the user can see no projects. There is no empty message and no link (`:263-269`). Same for zero published schemas (`:280-289`).
  3. `MappingPreview` swallows a parse failure into an empty state and renders nothing when no mappings result (`:395-400`, `:426-427`). The user learns the file is unreadable only after the file has been retained.
  4. Any failure titles itself "Ingestion failed — recorded as a failed run" (`:328-335`), including retention rejections that occur before any run exists (`:198`, `:78-85`).
  5. If the parser id is unregistered, the badge reads `undefined@undefined` (`:236-238`).
- **Blockers hit:** silent disabling, a preview that vanishes, and a failure title that can be wrong.
- **Verdict:** `partial`. The user can retry, but must guess what is missing or wrong.
- **Fix:** list unmet requirements beside the disabled button. Add empty states with links to Projects and Models. Show "This file could not be read by <parser>" in the preview. Title retention errors "File not retained".
- **Severity:** S2

### J-INS-16 Failed connector run: what next?
- **Persona / goal:** steward investigating a failed ingest or source import.
- **Entry:** Run history on the connector page, a red "Failed" row, or the Inbox "connector run" item that links to the connector (`inbox.tsx:135-139`).
- **Path:**
  1. Expanding a failed run shows `error_code: message` and log lines (`run-history.tsx:194-198`, `:239-244`). There is no retry, no link to credentials or config, and no hint by error code.
  2. Retry lineage exists in the server path (`tabular-ingestion.ts:478-485`, `:616-633`) but no run-history control calls it. The user re-selects the file and runs again (`ingest-panel.tsx:353-367`).
  3. If the runs query errors or is loading, the table body renders `null`, leaving an empty table with headers (`run-history.tsx:108`).
  4. A failed run is reachable from the Inbox but the panels that can fix it are hidden when paused (J-INS-14).
- **Blockers hit:** a named error with no remedy. An error state that shows nothing.
- **Verdict:** `dead-end` for non-obvious failures. A user can start again by hand.
- **Fix:** show a loading and an error row with retry. Add per-code next steps: `secret_missing` → Credentials, `invalid_destination` → Configuration (J-INS-13). Add "Retry this run" for source-import runs.
- **Severity:** S2

### J-INS-17 Scan an instrument label before using it
- **Persona / goal:** technician at the bench scanning INS-nnnn to check the instrument is safe to use, or fixing a bad scan.
- **Entry:** `/scan`, camera or typed ID.
- **Path:**
  1. Camera failure is handled well. Each state says what happened and "Type the ID below", with "Try again" for retryable states (`camera-scanner.tsx:55-63`, `:197-201`, `:240-251`, `:272-295`).
  2. An instrument hit shows `intakeHealth(row.intake_method)` with no evidence (`scan-data.ts:82-91`). For automated methods that reads "Waiting for first data" or "Parser not validated", never calibration or retired state. The query does not select `retired_at` or calibration (`:49-50`).
  3. The result card offers one button, "Open instrument" (`scan.tsx:103-110`, `scan-data.ts:119-121`). An overdue or retired instrument looks the same as a healthy one.
  4. A miss reads "No record with ID X." with did-you-mean suggestions or "Check the label and try again." (`scan.tsx:114-139`). There is no "Search" or "Register instrument" link.
- **Blockers hit:** the page the technician scans for gives the wrong status for the question being asked.
- **Verdict:** `partial`. Camera and typing fallback are `complete`. The instrument result misleads on calibration and retirement.
- **Fix:** select `retired_at` and the latest calibration. Show "Calibration overdue" or "Retired — can't be booked" in the status chip. Add "Search for it" and "Register an instrument" links on a miss.
- **Severity:** S2

## Summary

| ID | Title | Verdict | Severity |
| --- | --- | --- | --- |
| J-INS-01 | Parser warning follow-up (reference) | complete | n/a |
| J-INS-02 | Validated but unapproved parser, GxP import refused | partial | S2 |
| J-INS-03 | Validate and approve parser, disabled controls | partial | S2 |
| J-INS-04 | Member opens parser failure from inbox | dead-end | S2 |
| J-INS-05 | File not recognised at import | partial | S3 |
| J-INS-06 | Approved parser, import never resumed | dead-end | S2 |
| J-INS-07 | Review or commit refuses the import | partial | S2 |
| J-INS-08 | Import against overdue calibration | partial | S2 |
| J-INS-09 | Automated instrument not delivering data | dead-end | S2 |
| J-INS-10 | Calibration overdue, certificate cannot be attached | dead-end | S1 |
| J-INS-11 | Booking refused: unqualified or calibration overdue | dead-end | S1 |
| J-INS-12 | Recalibrated instrument still refused (suspected) | dead-end | S1 |
| J-INS-13 | Enterprise connector cannot be configured | dead-end | S1 |
| J-INS-14 | Paused, archived or non-executor connector | partial | S2 |
| J-INS-15 | Instrument file ingest panel | partial | S2 |
| J-INS-16 | Failed connector run | dead-end | S2 |
| J-INS-17 | Scan an instrument label | partial | S2 |

Counts: 1 complete, 8 partial, 8 dead-end (17 journeys). Severity: 4 S1 (one only if confirmed), 11 S2, 1 S3.
