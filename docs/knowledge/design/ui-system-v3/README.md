---
title: Sheetbase UI system v3 — design reference snapshot
status: reference; adoption proposed by Roadmap 4
last_reviewed: 2026-09-27
---

# Sheetbase UI system v3 — design reference snapshot

A verbatim snapshot of the Sheetbase ELN design: 126 screens on a design
canvas, and the Sheetbase design system they are built from. It is the
visual and behavioural target for [Roadmap 4](../../roadmap-4/README.md).

**This folder is reference material, not product code.** Nothing here is
imported by the application. `design-system/components/bundle.js` and
`bundle.css` only run inside the design canvas (they expect `window.React` and
the canvas runtime). Roadmap 4 re-implements the tokens and components in
`src/` and in `sheetbase-components`; see
[`../../roadmap-4/DESIGN_ADOPTION.md`](../../roadmap-4/DESIGN_ADOPTION.md).

## Source

| Item          | Source                                                                             | Version           |
| ------------- | ---------------------------------------------------------------------------------- | ----------------- |
| Screens       | Design canvas “Sheetbase ELN”, `https://claude.ai/artifact/AdwTHyqdHFg9eSnER8UiNY` | `1790422626-8f6f` |
| Design system | Design system “Sheetbase”, `https://claude.ai/artifact/RHGA9SezYnfKfJorUs6aHh`     | `1790422642-d168` |
| Runtime       | The canvas's `artifact-type/dc-runtime.js` (bundles React 18, MIT)                 | same as screens   |
| Captured      | 27 September 2026                                                                  |                   |

Both artifacts are private to their owner. `SHA256SUMS` lists every vendored
file; run `sha256sum -c SHA256SUMS` in this folder to confirm the snapshot is
unmodified. The canvas's own copy of the design system (`canvas/ds/`) was
byte-identical to `design-system/` and is not duplicated.

## Layout

| Path                                   | Contents                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------- |
| `canvas/*.dc.html`                     | One file per screen: the full markup, sample data and interaction script          |
| `canvas/canvas.json`                   | Board layout, page grouping, section titles                                       |
| `design-system/README.md`              | The brand book: principles, colour, type, spacing, writing, interaction rules     |
| `design-system/tokens.json`            | Every colour (light and dark), type style, spacing, radius, shadow and size token |
| `design-system/components/*/README.md` | Guidelines per component                                                          |
| `design-system/components/index.d.ts`  | Component props, as types                                                         |
| `design-system/components/bundle.*`    | The canvas implementation (reference only; see above)                             |
| `screen-text/*.txt`                    | Visible text of each screen without the shared shell, for grep and review         |
| `runtime/dc-runtime.js`                | The canvas runtime each screen loads as `support.js`; used only to render screens |
| `tools/extract_screen_text.py`         | Regenerates `screen-text/` from `canvas/`                                         |

## Rendering the screens

```bash
pnpm design:render                 # all screens, light and dark
pnpm design:render Main Notebook   # named screens
```

`scripts/design-reference.mts` serves this folder locally, answers each
screen's `support.js` with `runtime/dc-runtime.js`, answers Google Fonts
requests from the `@fontsource-variable` packages the app ships, and writes
`tests/visual/design-reference/<Screen>-<theme>.png` at each board's size from
`canvas.json`. It needs no network, and repeated renders are byte-identical.
These images are the expected images for the Roadmap 4 visual parity suite
(DSYS-06). Set `CHROMIUM_PATH` to use a preinstalled Chromium.

## Updating the snapshot

Replace `canvas/`, `design-system/` and `runtime/` from the artifacts together,
never piecemeal, then regenerate `screen-text/` and `SHA256SUMS`, update the versions
above, and note in the PR which screens changed. The folder is excluded from
Prettier so files stay byte-identical to the source.

## Reading a screen

Open the `.dc.html` for structure, component usage (`Sheetbase.*` mounts) and
states; open the matching `screen-text/*.txt` for copy. The sample data (EXP-0142,
DS-0311, SMP-2231 and so on) is one consistent scenario across all screens and is
reproduced exactly by the Roadmap 4 design seed (DSYS-05). Screens are 1440 px wide unless listed otherwise;
phone screens are 390×844.

## Screen index

### Workspace (20)

| Screen                               | File                                                                                                | Size      |
| ------------------------------------ | --------------------------------------------------------------------------------------------------- | --------- |
| Schedule                             | [`HomeBench`](canvas/HomeBench.dc.html) · [text](screen-text/HomeBench.txt)                         | 1440×900  |
| Home · First run (new user)          | [`HomeFirstRun`](canvas/HomeFirstRun.dc.html) · [text](screen-text/HomeFirstRun.txt)                | 1440×900  |
| Inbox                                | [`HomeTriage`](canvas/HomeTriage.dc.html) · [text](screen-text/HomeTriage.txt)                      | 1440×900  |
| Inbox · Nothing to do                | [`InboxEmpty`](canvas/InboxEmpty.dc.html) · [text](screen-text/InboxEmpty.txt)                      | 1440×900  |
| Home                                 | [`Main`](canvas/Main.dc.html) · [text](screen-text/Main.txt)                                        | 1440×900  |
| Project · AAV9 process transfer      | [`ProjectDetail`](canvas/ProjectDetail.dc.html) · [text](screen-text/ProjectDetail.txt)             | 1440×1000 |
| Project list                         | [`Projects`](canvas/Projects.dc.html) · [text](screen-text/Projects.txt)                            | 1440×900  |
| Projects · Empty workspace           | [`ProjectsEmpty`](canvas/ProjectsEmpty.dc.html) · [text](screen-text/ProjectsEmpty.txt)             | 1440×900  |
| Projects · Failed to load            | [`ProjectsError`](canvas/ProjectsError.dc.html) · [text](screen-text/ProjectsError.txt)             | 1440×900  |
| Projects · No search results         | [`ProjectsNoResults`](canvas/ProjectsNoResults.dc.html) · [text](screen-text/ProjectsNoResults.txt) | 1440×900  |
| Schedule · No bookings               | [`ScheduleEmpty`](canvas/ScheduleEmpty.dc.html) · [text](screen-text/ScheduleEmpty.txt)             | 1440×900  |
| Project · Files                      | [`ProjectFiles`](canvas/ProjectFiles.dc.html) · [text](screen-text/ProjectFiles.txt)                | 1440×1000 |
| Project · Members                    | [`ProjectMembers`](canvas/ProjectMembers.dc.html) · [text](screen-text/ProjectMembers.txt)          | 1440×1000 |
| Project · Settings                   | [`ProjectSettings`](canvas/ProjectSettings.dc.html) · [text](screen-text/ProjectSettings.txt)       | 1440×1000 |
| Pinned project · LVV stability       | [`ProjectLVV`](canvas/ProjectLVV.dc.html) · [text](screen-text/ProjectLVV.txt)                      | 1440×1000 |
| Pinned project · Ambr 250            | [`ProjectAmbr`](canvas/ProjectAmbr.dc.html) · [text](screen-text/ProjectAmbr.txt)                   | 1440×1000 |
| Help · records and signatures        | [`HelpRecords`](canvas/HelpRecords.dc.html) · [text](screen-text/HelpRecords.txt)                   | 1440×1000 |
| Signed out                           | [`SignedOut`](canvas/SignedOut.dc.html) · [text](screen-text/SignedOut.txt)                         | 1440×900  |
| Project · Folders                    | [`ProjectFolders`](canvas/ProjectFolders.dc.html) · [text](screen-text/ProjectFolders.txt)          | 1440×900  |
| Project · Move items between folders | [`FolderMove`](canvas/FolderMove.dc.html) · [text](screen-text/FolderMove.txt)                      | 1440×900  |

### Experiment (14)

| Screen                              | File                                                                              | Size      |
| ----------------------------------- | --------------------------------------------------------------------------------- | --------- |
| Datasets tab                        | [`ExpDatasets`](canvas/ExpDatasets.dc.html) · [text](screen-text/ExpDatasets.txt) | 1440×1000 |
| Files tab                           | [`ExpFiles`](canvas/ExpFiles.dc.html) · [text](screen-text/ExpFiles.txt)          | 1440×900  |
| History tab                         | [`ExpHistory`](canvas/ExpHistory.dc.html) · [text](screen-text/ExpHistory.txt)    | 1440×1000 |
| Overview tab                        | [`ExpOverview`](canvas/ExpOverview.dc.html) · [text](screen-text/ExpOverview.txt) | 1440×1000 |
| Results tab                         | [`ExpResults`](canvas/ExpResults.dc.html) · [text](screen-text/ExpResults.txt)    | 1440×1000 |
| Samples tab                         | [`ExpSamples`](canvas/ExpSamples.dc.html) · [text](screen-text/ExpSamples.txt)    | 1440×900  |
| Notebook · Conflict after reconnect | [`NbConflict`](canvas/NbConflict.dc.html) · [text](screen-text/NbConflict.txt)    | 1440×1000 |
| Notebook · Editing                  | [`NbEditing`](canvas/NbEditing.dc.html) · [text](screen-text/NbEditing.txt)       | 1440×1100 |
| Notebook · Loading                  | [`NbLoading`](canvas/NbLoading.dc.html) · [text](screen-text/NbLoading.txt)       | 1440×900  |
| Notebook · New from template        | [`NbNew`](canvas/NbNew.dc.html) · [text](screen-text/NbNew.txt)                   | 1440×1300 |
| Notebook · Offline                  | [`NbOffline`](canvas/NbOffline.dc.html) · [text](screen-text/NbOffline.txt)       | 1440×1000 |
| Notebook · Signed and locked        | [`NbSigned`](canvas/NbSigned.dc.html) · [text](screen-text/NbSigned.txt)          | 1440×1300 |
| Notebook · View-only access         | [`NbViewer`](canvas/NbViewer.dc.html) · [text](screen-text/NbViewer.txt)          | 1440×1000 |
| Notebook tab                        | [`Notebook`](canvas/Notebook.dc.html) · [text](screen-text/Notebook.txt)          | 1440×1840 |

### Review and signing (5)

| Screen                              | File                                                                                          | Size      |
| ----------------------------------- | --------------------------------------------------------------------------------------------- | --------- |
| Reviewer · approved and signed      | [`ReviewApproved`](canvas/ReviewApproved.dc.html) · [text](screen-text/ReviewApproved.txt)    | 1440×1180 |
| Reviewer · returning with a comment | [`ReviewRecord`](canvas/ReviewRecord.dc.html) · [text](screen-text/ReviewRecord.txt)          | 1440×1000 |
| Author · returned for changes       | [`ReviewReturned`](canvas/ReviewReturned.dc.html) · [text](screen-text/ReviewReturned.txt)    | 1440×1000 |
| Reviewer · signing dialog           | [`ReviewSign`](canvas/ReviewSign.dc.html) · [text](screen-text/ReviewSign.txt)                | 1440×1000 |
| Signed EXP-0133 · Evidence vs live  | [`EvidenceCompare`](canvas/EvidenceCompare.dc.html) · [text](screen-text/EvidenceCompare.txt) | 1440×900  |

### Flows and dialogs (6)

| Screen                         | File                                                                                    | Size      |
| ------------------------------ | --------------------------------------------------------------------------------------- | --------- |
| Creation dialogs               | [`DialogsCreate`](canvas/DialogsCreate.dc.html) · [text](screen-text/DialogsCreate.txt) | 1440×820  |
| Record dialogs                 | [`DialogsRecord`](canvas/DialogsRecord.dc.html) · [text](screen-text/DialogsRecord.txt) | 1440×1020 |
| Import · File not recognised   | [`ImportFailed`](canvas/ImportFailed.dc.html) · [text](screen-text/ImportFailed.txt)    | 1440×760  |
| Import · 2 Map and review      | [`ImportMap`](canvas/ImportMap.dc.html) · [text](screen-text/ImportMap.txt)             | 1440×900  |
| Import · 1 Upload              | [`ImportUpload`](canvas/ImportUpload.dc.html) · [text](screen-text/ImportUpload.txt)    | 1440×820  |
| New experiment from a protocol | [`NewExperiment`](canvas/NewExperiment.dc.html) · [text](screen-text/NewExperiment.txt) | 1440×900  |

### Records (27)

| Screen                                     | File                                                                                                   | Size      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------ | --------- |
| Dataset explorer · DS-0298 (missing units) | [`DatasetExplorer`](canvas/DatasetExplorer.dc.html) · [text](screen-text/DatasetExplorer.txt)          | 1440×1000 |
| Datasets · Partial load error              | [`DatasetsError`](canvas/DatasetsError.dc.html) · [text](screen-text/DatasetsError.txt)                | 1440×640  |
| Datasets list                              | [`DatasetsList`](canvas/DatasetsList.dc.html) · [text](screen-text/DatasetsList.txt)                   | 1440×900  |
| Experiments list                           | [`ExperimentsList`](canvas/ExperimentsList.dc.html) · [text](screen-text/ExperimentsList.txt)          | 1440×900  |
| Experiments · Loading                      | [`ExperimentsLoading`](canvas/ExperimentsLoading.dc.html) · [text](screen-text/ExperimentsLoading.txt) | 1440×760  |
| Materials list                             | [`MaterialsList`](canvas/MaterialsList.dc.html) · [text](screen-text/MaterialsList.txt)                | 1440×900  |
| Protocol · PRT-021 v3                      | [`ProtocolDetail`](canvas/ProtocolDetail.dc.html) · [text](screen-text/ProtocolDetail.txt)             | 1440×1000 |
| Protocols list                             | [`ProtocolsList`](canvas/ProtocolsList.dc.html) · [text](screen-text/ProtocolsList.txt)                | 1440×900  |
| Sample · Consumed                          | [`SampleConsumed`](canvas/SampleConsumed.dc.html) · [text](screen-text/SampleConsumed.txt)             | 1440×560  |
| Sample record · SMP-2231                   | [`SampleDetail`](canvas/SampleDetail.dc.html) · [text](screen-text/SampleDetail.txt)                   | 1440×1000 |
| Sample · Hold time exceeded                | [`SampleExpired`](canvas/SampleExpired.dc.html) · [text](screen-text/SampleExpired.txt)                | 1440×560  |
| Sample · Quarantine                        | [`SampleQuarantine`](canvas/SampleQuarantine.dc.html) · [text](screen-text/SampleQuarantine.txt)       | 1440×560  |
| Samples · Empty tab                        | [`SamplesEmpty`](canvas/SamplesEmpty.dc.html) · [text](screen-text/SamplesEmpty.txt)                   | 1440×640  |
| Samples list                               | [`SamplesList`](canvas/SamplesList.dc.html) · [text](screen-text/SamplesList.txt)                      | 1440×900  |
| Sample · Lineage                           | [`SampleLineage`](canvas/SampleLineage.dc.html) · [text](screen-text/SampleLineage.txt)                | 1440×1000 |
| Sample · Usage                             | [`SampleUsage`](canvas/SampleUsage.dc.html) · [text](screen-text/SampleUsage.txt)                      | 1440×1000 |
| Sample · Measurements                      | [`SampleMeasurements`](canvas/SampleMeasurements.dc.html) · [text](screen-text/SampleMeasurements.txt) | 1440×1000 |
| Sample · History                           | [`SampleHistory`](canvas/SampleHistory.dc.html) · [text](screen-text/SampleHistory.txt)                | 1440×1000 |
| Dataset DS-0311 · Snapshots                | [`DatasetSnapshots`](canvas/DatasetSnapshots.dc.html) · [text](screen-text/DatasetSnapshots.txt)       | 1440×900  |
| Dataset DS-0311 · Compare S-14 → S-15      | [`DatasetCompare`](canvas/DatasetCompare.dc.html) · [text](screen-text/DatasetCompare.txt)             | 1440×900  |
| Instrument INS-0007 · stable identity      | [`RecordInstrument`](canvas/RecordInstrument.dc.html) · [text](screen-text/RecordInstrument.txt)       | 1440×900  |
| Dataset DS-0188 · Snapshot rows removed    | [`SnapshotRemoved`](canvas/SnapshotRemoved.dc.html) · [text](screen-text/SnapshotRemoved.txt)          | 1440×900  |
| Model Cell bank · Records                  | [`ModelRecords`](canvas/ModelRecords.dc.html) · [text](screen-text/ModelRecords.txt)                   | 1440×900  |
| Cell bank CB-0012 · Record page            | [`RecordDetail`](canvas/RecordDetail.dc.html) · [text](screen-text/RecordDetail.txt)                   | 1440×1000 |
| New cell bank · form from the model        | [`RecordNew`](canvas/RecordNew.dc.html) · [text](screen-text/RecordNew.txt)                            | 1440×900  |
| Model Cell bank · Fields                   | [`ModelFields`](canvas/ModelFields.dc.html) · [text](screen-text/ModelFields.txt)                      | 1440×900  |
| Model Cell bank · Versions                 | [`ModelVersions`](canvas/ModelVersions.dc.html) · [text](screen-text/ModelVersions.txt)                | 1440×900  |

### Sheets and templates (7)

| Screen                                    | File                                                                                          | Size      |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- | --------- |
| Working sheet SHT-0019 · local columns    | [`SheetWorking`](canvas/SheetWorking.dc.html) · [text](screen-text/SheetWorking.txt)          | 1440×1000 |
| Working sheet · Promote columns           | [`SheetPromote`](canvas/SheetPromote.dc.html) · [text](screen-text/SheetPromote.txt)          | 1440×1000 |
| Templates                                 | [`TemplatesList`](canvas/TemplatesList.dc.html) · [text](screen-text/TemplatesList.txt)       | 1440×900  |
| Template v4 · update an existing notebook | [`TemplateUpdate`](canvas/TemplateUpdate.dc.html) · [text](screen-text/TemplateUpdate.txt)    | 1440×900  |
| Working sheet · Empty                     | [`SheetEmpty`](canvas/SheetEmpty.dc.html) · [text](screen-text/SheetEmpty.txt)                | 1440×900  |
| Working sheet · Promotion returned by QA  | [`PromoteRejected`](canvas/PromoteRejected.dc.html) · [text](screen-text/PromoteRejected.txt) | 1440×1000 |
| Template TPL-006 · Editing draft v5       | [`TemplateEditor`](canvas/TemplateEditor.dc.html) · [text](screen-text/TemplateEditor.txt)    | 1440×1000 |

### Analysis and search (5)

| Screen                       | File                                                                                    | Size      |
| ---------------------------- | --------------------------------------------------------------------------------------- | --------- |
| Analysis workspace · AN-0057 | [`Analysis`](canvas/Analysis.dc.html) · [text](screen-text/Analysis.txt)                | 1440×1000 |
| Analysis · No data           | [`AnalysisEmpty`](canvas/AnalysisEmpty.dc.html) · [text](screen-text/AnalysisEmpty.txt) | 1440×640  |
| Search · No results          | [`SearchEmpty`](canvas/SearchEmpty.dc.html) · [text](screen-text/SearchEmpty.txt)       | 1440×560  |
| Search · ⌘K palette          | [`SearchPalette`](canvas/SearchPalette.dc.html) · [text](screen-text/SearchPalette.txt) | 1440×900  |
| Search · Results page        | [`SearchResults`](canvas/SearchResults.dc.html) · [text](screen-text/SearchResults.txt) | 1440×1000 |

### Pipelines (7)

| Screen                                    | File                                                                                                   | Size      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------- |
| Pipelines list                            | [`PipelinesList`](canvas/PipelinesList.dc.html) · [text](screen-text/PipelinesList.txt)                | 1440×900  |
| Pipeline editor · steps and preview       | [`PipelineEditor`](canvas/PipelineEditor.dc.html) · [text](screen-text/PipelineEditor.txt)             | 1440×1000 |
| Pipeline · triggers, outputs, permissions | [`PipelineTriggers`](canvas/PipelineTriggers.dc.html) · [text](screen-text/PipelineTriggers.txt)       | 1440×1080 |
| Pipeline · runs and versions              | [`PipelineRuns`](canvas/PipelineRuns.dc.html) · [text](screen-text/PipelineRuns.txt)                   | 1440×1000 |
| Run · succeeded, kept nothing             | [`PipelineRun`](canvas/PipelineRun.dc.html) · [text](screen-text/PipelineRun.txt)                      | 1440×1000 |
| Run · waiting for a person                | [`PipelineRunWaiting`](canvas/PipelineRunWaiting.dc.html) · [text](screen-text/PipelineRunWaiting.txt) | 1440×900  |
| Run · failed, storage limit               | [`PipelineRunFailed`](canvas/PipelineRunFailed.dc.html) · [text](screen-text/PipelineRunFailed.txt)    | 1440×900  |

### Models (3)

| Screen                                    | File                                                                                    | Size      |
| ----------------------------------------- | --------------------------------------------------------------------------------------- | --------- |
| Model editor · Clarification run v5 draft | [`SchemaEditor`](canvas/SchemaEditor.dc.html) · [text](screen-text/SchemaEditor.txt)    | 1440×1000 |
| Model · Awaiting QA approval              | [`SchemaPending`](canvas/SchemaPending.dc.html) · [text](screen-text/SchemaPending.txt) | 1440×640  |
| Models list                               | [`SchemasList`](canvas/SchemasList.dc.html) · [text](screen-text/SchemasList.txt)       | 1440×900  |

### Settings and admin (15)

| Screen                                    | File                                                                                                            | Size      |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------- |
| Audit log                                 | [`AuditLog`](canvas/AuditLog.dc.html) · [text](screen-text/AuditLog.txt)                                        | 1440×900  |
| Client portal · CL-017                    | [`ClientPortal`](canvas/ClientPortal.dc.html) · [text](screen-text/ClientPortal.txt)                            | 1440×900  |
| Settings · Instruments and parsers        | [`SettingsInstruments`](canvas/SettingsInstruments.dc.html) · [text](screen-text/SettingsInstruments.txt)       | 1440×900  |
| Settings · Members and roles              | [`SettingsMembers`](canvas/SettingsMembers.dc.html) · [text](screen-text/SettingsMembers.txt)                   | 1440×900  |
| Settings · My electronic signature        | [`SettingsSignature`](canvas/SettingsSignature.dc.html) · [text](screen-text/SettingsSignature.txt)             | 1440×900  |
| Settings · General                        | [`SettingsGeneral`](canvas/SettingsGeneral.dc.html) · [text](screen-text/SettingsGeneral.txt)                   | 1440×900  |
| Settings · Project access                 | [`SettingsAccess`](canvas/SettingsAccess.dc.html) · [text](screen-text/SettingsAccess.txt)                      | 1440×900  |
| Settings · Profile and appearance         | [`SettingsProfile`](canvas/SettingsProfile.dc.html) · [text](screen-text/SettingsProfile.txt)                   | 1440×1000 |
| Settings · Notifications                  | [`SettingsNotifications`](canvas/SettingsNotifications.dc.html) · [text](screen-text/SettingsNotifications.txt) | 1440×900  |
| Settings · Integrations                   | [`SettingsIntegrations`](canvas/SettingsIntegrations.dc.html) · [text](screen-text/SettingsIntegrations.txt)    | 1440×1000 |
| Settings · API and SDK                    | [`SettingsApi`](canvas/SettingsApi.dc.html) · [text](screen-text/SettingsApi.txt)                               | 1440×900  |
| Integrations · Connect a system           | [`IntegrationConnect`](canvas/IntegrationConnect.dc.html) · [text](screen-text/IntegrationConnect.txt)          | 1440×1000 |
| Integrations · Webhook deliveries failing | [`IntegrationDeliveries`](canvas/IntegrationDeliveries.dc.html) · [text](screen-text/IntegrationDeliveries.txt) | 1440×900  |
| API · New token, shown once               | [`TokenCreate`](canvas/TokenCreate.dc.html) · [text](screen-text/TokenCreate.txt)                               | 1440×900  |
| API · Expired token still in use          | [`TokenExpired`](canvas/TokenExpired.dc.html) · [text](screen-text/TokenExpired.txt)                            | 1440×900  |

### Narrow screens (5)

| Screen                             | File                                                                                          | Size     |
| ---------------------------------- | --------------------------------------------------------------------------------------------- | -------- |
| Notebook · 1024px laptop           | [`NotebookLaptop`](canvas/NotebookLaptop.dc.html) · [text](screen-text/NotebookLaptop.txt)    | 1024×760 |
| Notebook · tablet, panel as drawer | [`NotebookTablet`](canvas/NotebookTablet.dc.html) · [text](screen-text/NotebookTablet.txt)    | 834×1112 |
| Projects · tablet                  | [`ProjectsTablet`](canvas/ProjectsTablet.dc.html) · [text](screen-text/ProjectsTablet.txt)    | 834×1112 |
| Working sheet on tablet            | [`SheetTablet`](canvas/SheetTablet.dc.html) · [text](screen-text/SheetTablet.txt)             | 834×1112 |
| Dataset snapshots at 1024px        | [`SnapshotsLaptop`](canvas/SnapshotsLaptop.dc.html) · [text](screen-text/SnapshotsLaptop.txt) | 1024×760 |

### Phone (8)

| Screen                    | File                                                                                    | Size    |
| ------------------------- | --------------------------------------------------------------------------------------- | ------- |
| Phone · Today             | [`PhoneHome`](canvas/PhoneHome.dc.html) · [text](screen-text/PhoneHome.txt)             | 390×844 |
| Phone · Scan a label      | [`PhoneScan`](canvas/PhoneScan.dc.html) · [text](screen-text/PhoneScan.txt)             | 390×844 |
| Phone · Sample after scan | [`PhoneSample`](canvas/PhoneSample.dc.html) · [text](screen-text/PhoneSample.txt)       | 390×844 |
| Phone · Withdraw volume   | [`PhoneWithdraw`](canvas/PhoneWithdraw.dc.html) · [text](screen-text/PhoneWithdraw.txt) | 390×844 |
| Phone · Record a reading  | [`PhoneReading`](canvas/PhoneReading.dc.html) · [text](screen-text/PhoneReading.txt)    | 390×844 |
| Phone · Inbox             | [`PhoneInbox`](canvas/PhoneInbox.dc.html) · [text](screen-text/PhoneInbox.txt)          | 390×844 |
| Phone · Evidence vs live  | [`EvidencePhone`](canvas/EvidencePhone.dc.html) · [text](screen-text/EvidencePhone.txt) | 390×844 |
| Phone · Scanned cell bank | [`RecordPhone`](canvas/RecordPhone.dc.html) · [text](screen-text/RecordPhone.txt)       | 390×844 |

### Interaction and keyboard (3)

| Screen               | File                                                                           | Size      |
| -------------------- | ------------------------------------------------------------------------------ | --------- |
| Interaction states   | [`States`](canvas/States.dc.html) · [text](screen-text/States.txt)             | 1440×1390 |
| Keyboard focus order | [`FocusOrder`](canvas/FocusOrder.dc.html) · [text](screen-text/FocusOrder.txt) | 1440×760  |
| Keyboard shortcuts   | [`Shortcuts`](canvas/Shortcuts.dc.html) · [text](screen-text/Shortcuts.txt)    | 1440×900  |

### Sidebars and panels (1)

| Screen                               | File                                                               | Size      |
| ------------------------------------ | ------------------------------------------------------------------ | --------- |
| Left navigation and inspector states | [`Panels`](canvas/Panels.dc.html) · [text](screen-text/Panels.txt) | 1440×1860 |
