# Sheetbase ELN — Roadmap 5 defect catalogue

Exhaustive QA of the shipped application on `GWP/roadmap-5-qa`. Two blockers, 74 major,
111 minor and 17 nit findings, each tied to a route or `file:line` and to the evidence that
produced it. §2 records what a real browser confirmed; §3 is the catalogue; §4 is the order
to fix it in.

| | |
|---|---|
| Date | 2026-10-11 |
| Branch | `GWP/roadmap-5-qa` (27 commits over `main`) |
| Findings | 204 total — 2 blocker, 74 major, 111 minor, 17 nit |
| Areas swept | shell/work, projects/experiments, data/analysis, lab, sheets/models, platform/settings |
| Live environment | dev server on `127.0.0.1:3059`, fresh database (429 migrations + demo seed), design fixture identity |
| Viewports | 1440×900 desktop, 390×844 phone |

## 1. Method

Two passes, kept separate on purpose.

**Code sweep.** Six reviewers read the current source by product area — shell and work items,
projects and experiments, data and analysis, lab surfaces, sheets and models, and the platform
surfaces (settings, auth, review, evidence, portal). Every finding states a route or a
`file:line`, the code that proves it, and whether the claim is `code-conclusive` (the source
settles it), `needs-live-check` (only a rendered surface can settle it), or `verified-live`.

**Live sweep.** A headless Chromium drove the running app against a fresh database: about a
hundred routes at desktop width and a phone pass over the same surface, capturing console
errors, failed requests, horizontal overflow and the rendered text of each route. Claims that
survived a targeted re-check are in §2.1; claims that did not are in §2.3 and are *not* filed
as defects.

A finding is a *defect* here when a real user meets a wrong, misleading, dead-end or
unavailable outcome. Absent features are only listed when the shipped copy or affordance
promises them.

## 2. Live verification

### 2.1 Confirmed defects

**Replacement-lot lookup can never match — blocker.** `fetchReplacementLot`
(`src/lib/reagent-data.ts:600-608`) asks PostgREST for
`record_links?source_record_id=in.(select id from api.records where identifier=eq.X)`.
PostgREST reads `in.(…)` as a literal value list, so the request fails before it is a query.
Reproduced against the running app with the exact string the app builds:

```
GET /api/db/record_links?source_record_id=in.(select id from api.records where identifier=eq.MAT-0001)
    &link_type=eq.material&limit=25&select=id,target_record_id,target_identifier,link_metadata
400 {"error":{"category":"validation_error",
     "message":"invalid input syntax for type uuid: \"select id from api.records where identifier=eq.MAT-0001\""}}

GET /api/db/record_links?link_type=eq.material&limit=2      -> 200   (control, same table)
```

Effect: the material inspector always states no replacement lot exists, including when one
does. A two-step read (resolve the identifier to an id, then filter `source_record_id=eq.<uuid>`)
fixes it.

**Sheet deep links open read-only — blocker.** Every canonical sheet link is `/sheets/<id>` with
no search parameters (`src/lib/navigation.ts:22`), but editability is keyed off the `projectId`
search param: `src/routes/sheets/$sheetId.tsx:157-159` passes `readOnly={!projectIdParam}` even
though line 71 already computes the instance’s own project. Recents, favourites, search results
and comment deep-links therefore all land read-only. Confirmed in the browser on both seeded
instances (`67d5c8d3…0d8041` “Clarification working sheet” and `e12fc86e…5b70fb` “Untitled
sheet”): both render their columns and values, neither is editable, and nothing on the page says
why. The sheet loads — the *editing* is silently withheld.

### 2.2 Clean results

- About a hundred routes at 1440×900: no uncaught console errors, no horizontal overflow, no blank pages.
- The adopted shell rendered on every product route (sidebar at desktop, bottom tabs at phone width).
- The sheet surface itself works: both seeded instances load their columns, values and the
  display-only sorting note; the failure mode is editability, not loading.
- No `>=400` response on `/protocols/PRJ-006`, `/templates/TMPL-0001`, `/settings/profile` or
  `/materials` on targeted re-check.

### 2.3 Observed once, not reproduced — not filed as defects

- **Home at 390×844** measured `scrollWidth` 686 (296 px of overflow) with a `TableBox` table as
  the widest subtree. On re-check the same page measured 390 with no element extending past the
  viewport. Reported here so it is not lost; it needs a deterministic repro before it is a defect.
- **First-pass failed-request flags** on `/settings/profile`, `/settings/access` and
  `/settings/audit` did not reproduce: targeted re-checks captured no failing request. Treat as
  noise until a repro exists.

## 3. Catalogue

### 3.1 Summary

| Area | Blocker | Major | Minor | Nit | Total |
|---|---:|---:|---:|---:|---:|
| Project milestones | 0 | 3 | 4 | 1 | 8 |
| Instruments | 0 | 3 | 4 | 0 | 7 |
| Materials | 1 | 2 | 4 | 0 | 7 |
| Templates | 0 | 3 | 3 | 1 | 7 |
| Analysis studio › export | 0 | 3 | 0 | 0 | 3 |
| Project files tab | 0 | 3 | 0 | 0 | 3 |
| Shell / notification bell | 0 | 3 | 0 | 0 | 3 |
| Models | 0 | 2 | 9 | 0 | 11 |
| Sheets | 1 | 1 | 6 | 3 | 11 |
| Samples (detail) | 0 | 2 | 2 | 0 | 4 |
| Pipelines · Runs | 0 | 2 | 1 | 0 | 3 |
| Pipelines · Triggers | 0 | 2 | 1 | 0 | 3 |
| Scan | 0 | 2 | 1 | 0 | 3 |
| Analysis view (read-only) | 0 | 2 | 0 | 0 | 2 |
| Experiments list | 0 | 1 | 3 | 0 | 4 |
| Projects list | 0 | 1 | 2 | 1 | 4 |
| Protocols | 0 | 1 | 3 | 0 | 4 |
| Datasets › Compare tab | 0 | 1 | 2 | 0 | 3 |
| Pipelines · List | 0 | 1 | 2 | 0 | 3 |
| Schedule / booking dialog | 0 | 1 | 2 | 0 | 3 |
| Search / command palette | 0 | 1 | 2 | 0 | 3 |
| Search / results page | 0 | 1 | 2 | 0 | 3 |
| Shell / workspace switcher | 0 | 1 | 2 | 0 | 3 |
| Auth · sign-in | 0 | 1 | 1 | 0 | 2 |
| Datasets › Rows grid | 0 | 1 | 1 | 0 | 2 |
| Experiment results tab | 0 | 1 | 1 | 0 | 2 |
| Pipelines · Steps | 0 | 1 | 1 | 0 | 2 |
| Project folders | 0 | 1 | 1 | 0 | 2 |
| Project members | 0 | 1 | 1 | 0 | 2 |
| Project overview | 0 | 1 | 1 | 0 | 2 |
| Samples (list) | 0 | 1 | 1 | 0 | 2 |
| Settings · API and SDK | 0 | 1 | 1 | 0 | 2 |
| Shell / nav counts | 0 | 1 | 1 | 0 | 2 |
| Analysis studio › analyse mode | 0 | 1 | 0 | 0 | 1 |
| Analysis studio › data preview | 0 | 1 | 0 | 0 | 1 |
| Analysis studio › flag handling | 0 | 1 | 0 | 0 | 1 |
| Analysis studio › load view | 0 | 1 | 0 | 0 | 1 |
| Analysis studio › saved views | 0 | 1 | 0 | 0 | 1 |
| Datasets › detail tabs | 0 | 1 | 0 | 0 | 1 |
| Datasets › list (mobile) | 0 | 1 | 0 | 0 | 1 |
| Help / copy | 0 | 1 | 0 | 0 | 1 |
| Help / release | 0 | 1 | 0 | 0 | 1 |
| Home / counts | 0 | 1 | 0 | 0 | 1 |
| Inbox / error state | 0 | 1 | 0 | 0 | 1 |
| Inbox / list | 0 | 1 | 0 | 0 | 1 |
| Inbox / mark seen | 0 | 1 | 0 | 0 | 1 |
| New experiment | 0 | 1 | 0 | 0 | 1 |
| Pipelines · Run alias | 0 | 1 | 0 | 0 | 1 |
| Project settings | 0 | 1 | 0 | 0 | 1 |
| Registries (shared) | 0 | 1 | 0 | 0 | 1 |
| Review · signing/inspector | 0 | 1 | 0 | 0 | 1 |
| Schedule / grid bounds | 0 | 1 | 0 | 0 | 1 |
| Schedule / phone variant | 0 | 1 | 0 | 0 | 1 |
| Schedule / timezone | 0 | 1 | 0 | 0 | 1 |
| Viz › ChartFrame | 0 | 1 | 0 | 0 | 1 |
| Pipelines · Agents | 0 | 0 | 4 | 0 | 4 |
| Import › map step | 0 | 0 | 2 | 1 | 3 |
| Client portal | 0 | 0 | 2 | 0 | 2 |
| Experiment detail frame | 0 | 0 | 1 | 1 | 2 |
| Review · signing | 0 | 0 | 2 | 0 | 2 |
| Settings · Audit log | 0 | 0 | 1 | 1 | 2 |
| Settings · General | 0 | 0 | 1 | 1 | 2 |
| Analysis home | 0 | 0 | 0 | 1 | 1 |
| Datasets › Imports tab | 0 | 0 | 1 | 0 | 1 |
| Datasets › Snapshots create | 0 | 0 | 1 | 0 | 1 |
| Datasets › detail | 0 | 0 | 1 | 0 | 1 |
| Datasets › list toolbar | 0 | 0 | 1 | 0 | 1 |
| Evidence | 0 | 0 | 1 | 0 | 1 |
| Help / shortcuts | 0 | 0 | 1 | 0 | 1 |
| Import › file size formatting | 0 | 0 | 1 | 0 | 1 |
| Import › review step | 0 | 0 | 1 | 0 | 1 |
| Import › upload step | 0 | 0 | 1 | 0 | 1 |
| Inbox / filters | 0 | 0 | 1 | 0 | 1 |
| Instruments (detail) | 0 | 0 | 1 | 0 | 1 |
| Instruments (list) | 0 | 0 | 1 | 0 | 1 |
| Materials/Instruments | 0 | 0 | 1 | 0 | 1 |
| Project datasets tab | 0 | 0 | 1 | 0 | 1 |
| Project detail header | 0 | 0 | 1 | 0 | 1 |
| Project tabs (all) | 0 | 0 | 1 | 0 | 1 |
| Readings | 0 | 0 | 1 | 0 | 1 |
| Records | 0 | 0 | 1 | 0 | 1 |
| Review · decisions | 0 | 0 | 1 | 0 | 1 |
| Review · header | 0 | 0 | 0 | 1 | 1 |
| Samples (withdraw) | 0 | 0 | 1 | 0 | 1 |
| Schedule / empty state | 0 | 0 | 1 | 0 | 1 |
| Schedule / weekend copy | 0 | 0 | 1 | 0 | 1 |
| Settings · Electronic signatures | 0 | 0 | 1 | 0 | 1 |
| Settings · Integrations | 0 | 0 | 1 | 0 | 1 |
| Settings · Members | 0 | 0 | 1 | 0 | 1 |
| Settings · Notifications | 0 | 0 | 1 | 0 | 1 |
| Settings · Profile | 0 | 0 | 1 | 0 | 1 |
| Settings · Project access | 0 | 0 | 1 | 0 | 1 |
| Shell / bottom tabs | 0 | 0 | 0 | 1 | 1 |
| Shell / nav visibility | 0 | 0 | 1 | 0 | 1 |
| Shell / notification popover | 0 | 0 | 1 | 0 | 1 |
| Shell / sidebar | 0 | 0 | 0 | 1 | 1 |
| Shell / theme+collapse | 0 | 0 | 1 | 0 | 1 |
| UI primitives · ConfirmDialog | 0 | 0 | 0 | 1 | 1 |
| UI primitives · Secret | 0 | 0 | 1 | 0 | 1 |
| UI primitives · Table | 0 | 0 | 0 | 1 | 1 |
| Viz › CompareView chart | 0 | 0 | 1 | 0 | 1 |
| Viz › chart configurator | 0 | 0 | 0 | 1 | 1 |
| **Total** | **2** | **74** | **111** | **17** | **204** |

### 3.2 Recurring themes

Most of the 204 findings collapse into eight classes. Fixing a class fixes its members.

| # | Theme | What it looks like | Examples |
|---|---|---|---|
| 1 | **Copy promises what the UI cannot do** | A notice or button describes an action that has no control behind it | trigger creation (`pipelines/$pipelineId/triggers.tsx:141-146`), pipeline creation (`pipelines.tsx:148-160`), first pipeline version (`steps.tsx:142-146`), portal “Reply” for non-clients (`client-portal.tsx:498-508`) |
| 2 | **Destructive actions without confirmation** | Permanent, unrecoverable actions fire straight from a row or dialog | trigger delete (`triggers.tsx:126-132`), token revoke/rotate (`settings-api-tokens.tsx:236-241`), suspend member (`settings/members.tsx:372-401`), withdraw certification (`settings/signatures.tsx:146-190`), disable execution policy (`agent-surface.tsx:860-868`) |
| 3 | **Silent failures** | A mutation has no `onError` and no error surface, so a refused write looks like a no-op | revoke/rotate (`settings/api.tsx:86-129`), connector pause (`settings/integrations/$connectorId.tsx:55-60`), signature verify/practice (`settings/signatures.tsx`), appearance write (`settings/profile.tsx:51-52`), clipboard copy (`ui/secret.tsx:19-22`) |
| 4 | **Status and copy contradict behaviour** | Labels, counts or toasts describe a state the code does not implement | “Mark all read” writes nothing (`app-shell.tsx:598-635`), “Sorted by due date” (`inbox.tsx:399-401`), “1 selected” auto-selected (`pipelines.tsx:129,321`), “the run is resuming” after Stop (`runs/$runId.tsx:63`), sidebar badge vs Inbox tab counts (`shell-counts.server.ts:33`) |
| 5 | **Raw identifiers shown to people** | UUIDs and machine strings reach the UI where names exist | reviewer names and witness picker (`review/$revisionId.tsx:1671,2549,1058`), trigger spec jsonb (`triggers.tsx:99`) |
| 6 | **Dead ends with no way back** | A missing row or unhandled error renders nothing, or a panel vanishes with no explanation | run-alias redirect returns `null` (`pipelines/runs/$runId.tsx:14-24`), search failure looks like no results (`search.tsx:337`), inbox failure looks like an empty inbox (`inbox.tsx:406-419`), signing panel renders nothing when the reason is unknown (`review/$revisionId.tsx:2494-2510`) |
| 7 | **Empty states that blame the user** | An empty list is presented as “nothing here” when the cause is access, scope or a failed query | access-scoped lists (`13159c67` fixed one instance; others remain), disabled controls with no reason (`settings/access.tsx:184-196`, `agent-surface.tsx:736-738`) |
| 8 | **Phone and responsive gaps** | Controls hidden at phone width with no alternative, or a table that cannot scroll | schedule navigation (`schedule.tsx:141-162`), workspace switcher (`app-shell.tsx:500-501`) |

### 3.3 Findings by area

“Status” is the verification state of the finding: **code** = the source settles it,
**needs live check** = only a rendered surface can settle it, **verified live** = confirmed in
this sweep (§2).

#### Project milestones (8 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `/projects/$projectId/milestones` | The detail panel is `hidden ... xl:flex`; Move date, Mark done, client-visibility toggle, "Done when" conditions, dependencies and date history only live there, so at widths < 1280px the milestone rows are clickable to select but no action is reachable. | needs live check |
| major | `/projects/$projectId/milestones` | Hiding a milestone from the client uses window.prompt for the reason; cancelling the prompt yields '' and still fires the mutate, hiding it with an empty reason, and any edit to polling-hostile prompt is not re-validated (server requires a reason to hide). | needs live check |
| major | `/projects/$projectId/milestones` | Edit permission is gated on workspace capability 'schema.edit' (owner/admin/steward only), while the on-screen notice says "Only project editors can add milestones, move dates or mark them done" — a project editor/scientist who is not a governed-schema role cannot edit, and a governed-schema role who is not a member is treated as editor. | code-only |
| minor | `/projects/$projectId/milestones` | `?state=denied` overrides real permissions in production, and `state=empty` is validated but never used — a dead test-only query param. | code-only |
| minor | `/projects/$projectId/milestones` | Add-milestone silently disables its submit button below 3 trimmed characters with no inline error, unlike other dialogs that show a message. | code-only |
| minor | `/projects/$projectId/milestones` | Phase band is painted success-green whenever its span has passed, regardless of whether its milestones are done — a completed-looking bar over open work. | needs live check |
| minor | `/projects/$projectId/milestones` | Risk "late" and status "Late" disagree: status shows a passing overdue date as Late only for not_started tasks, so an overdue task in review/blocked reads "In review"/"Blocked" while AT_RISK_RULE says Late means the due date has passed. | code-only |
| nit | `/projects/$projectId/milestones` | Timeline legend omits the grey "unknown" risk swatch that RISK_FILL/base state actually renders when the risk read has no row. | code-only |

<details><summary>Evidence</summary>

- `/projects/$projectId/milestones` — src/routes/projects/$projectId/milestones.tsx:709 `className="hidden w-[340px] shrink-0 flex-col gap-4 overflow-auto border-l border-border bg-surface p-4 xl:flex"`; actions only at :759+ inside it.
- `/projects/$projectId/milestones` — src/routes/projects/$projectId/milestones.tsx:818-827 `setVisibility.mutate({..., clientVisible:false, reason: (window.prompt(...) ?? '')})` inside an onChange.
- `/projects/$projectId/milestones` — src/routes/projects/$projectId/milestones.tsx:139 `const canEdit = hasCapability(context.workspace?.role, 'schema.edit')`; capability.ts:57-61 maps schema.edit to GOVERNED_SCHEMA_ROLES; notice copy at :565-567.
- `/projects/$projectId/milestones` — src/routes/projects/$projectId/milestones.tsx:89-91 accepts 'denied'\|'empty'; :140 `const denied = state === 'denied' \|\| !canEdit`; `empty` appears nowhere else in the file.
- `/projects/$projectId/milestones` — src/routes/projects/$projectId/milestones.tsx:1098 `disabled={busy \|\| title.trim().length < 3 \|\| !dueAt}` — no `error`/hint on the Name field.
- `/projects/$projectId/milestones` — src/components/v3/projects/milestone-timeline.tsx:330-336 `band.end < now ? 'bg-success-wash' : ...`.
- `/projects/$projectId/milestones` — src/routes/projects/$projectId/milestones.tsx:99 AT_RISK_RULE; :102-111 milestoneStatus returns review/in progress before the due-date check.
- `/projects/$projectId/milestones` — src/components/v3/projects/milestone-timeline.tsx RISK_FILL `unknown: 'bg-border-strong'` vs legend at ~:380-400 listing only On track/At risk/Late/Done/Client-visible.

</details>

#### Instruments (7 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/routes/instruments.tsx:104-134 vs src/components/v3/instruments/i…` | Calibration 'due' windows disagree: the registry calls a calibration 'due soon' at ≤14 days and the filter says 'Due in 14 days', while the record page's `calibrationStatus` says 'Due soon' at ≤30 days. The same instrument is 'due' on one surface and 'valid' on the other. | code |
| major | `src/routes/instruments.tsx:173-177` | Registry-list health ignores parser readiness. `healthFor` passes only `lastImport`; the inspector passes `parserReady`. An automated-method instrument with no validated parser reads "Waiting for first data" in the list but "Parser not validated" in the inspector — two different truthful states for the same instrument. | needs live check |
| major | `src/routes/instruments/$instrumentId.tsx (whole page)` | Qualification is unreachable. Booking requires a current `instrument_qualifications` row (ADR-0054/LAB-06.3, unconditional), but no UI renders, grants or revokes a qualification: the record page has Calibration/Data intake/Runs only, and nothing in src calls `set_instrument_qualification` / `revoke_instrument_qualification`. An unqualified user is refused with no way to fix it, and the schema comment that 'the instr… | code |
| minor | `src/routes/instruments.tsx:342-346,428` | Vocabulary drift for the same concept: the filter and column are labelled 'Connection', the tab 'Connected', while the registry inspector and detail call the same field 'How data gets in' / intake method. | code |
| minor | `src/routes/instruments.tsx:563-567` | Footer denominator includes retired instruments while the label claims 'in service': `counts.all = rows.length` (all, incl. retired) but the 'all' tab's visible list excludes retired. | code |
| minor | `src/routes/instruments.tsx:895-900` | Register-instrument server errors are surfaced under the Serial number field only: `onError` sets `serverError` and `errors.serial = ... serverError`, so an unrelated refusal (permission, workspace) renders as if the serial were wrong. | code |
| minor | `src/routes/instruments/$instrumentId.tsx:365-366` | Placeholder/coming-soon copy in a product path: the calibration dialog's Notes hint says "Certificate upload comes with the file capability." | code |

<details><summary>Evidence</summary>

- `src/routes/instruments.tsx:104-134 vs src/components/v3/instruments/i…` — `if (days <= 14) return { state:'soon', ... }` (instruments.tsx:124) vs `if (due - now.getTime() <= 30 * 86_400_000) return { tone:'warn', label:'Due soon' }` (instruments-data.ts).
- `src/routes/instruments.tsx:173-177` — list: `intakeHealth(instrument.intakeMethod, { lastImport: ... })`; inspector: `intakeHealth(..., { parserReady: parsers.isSuccess ? parserReady : undefined, lastImport: ... })` (instruments.tsx:603).
- `src/routes/instruments/$instrumentId.tsx (whole page)` — src/db/schema.ts:4226-4228 comment; grep src for `qualification`/`valid_until` = booking dialog comments only; drizzle 0365 grants both RPCs. `$instrumentId.tsx` Sections: Data intake, Calibration, Runs.
- `src/routes/instruments.tsx:342-346,428` — `<label ...>Connection` + `<TableHead>Connection</TableHead>` vs `InspectorSection title='Connection'` items `['Method', intakeMethodLabel(...)]` and the RadioGroup 'How data gets in'.
- `src/routes/instruments.tsx:563-567` — `counts = { all: rows.length, ... }`; `if (tab === 'all' && i.retiredAt) return false`; footer `{visible.length} of {counts[tab]} {tab === 'all' ? 'instruments in service' : ...}`.
- `src/routes/instruments.tsx:895-900` — `serial: !f.serial.trim() ? '...' : serverError` with `onError` setting `serverError = ... 'Could not register the instrument.'`.
- `src/routes/instruments/$instrumentId.tsx:365-366` — `hint="Optional. Certificate upload comes with the file capability."`

</details>

#### Materials (7 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| blocker | `src/lib/reagent-data.ts:607-609` | Replacement-lot lookup can never match. The query uses a SQL subquery inside PostgREST `in.()` — `source_record_id=in.(select id from api.records where identifier=eq.X)` — which PostgREST treats as a single literal (and fails to cast to uuid), so the request errors and the inspector always falls through to "No replacement lot" even when one exists. | verified live |
| major | `src/routes/materials.tsx:165-181,413-423` | Quarantining a lot is one-way in the UI. The movement RPC supports operation 'restore' and `MOVEMENT_LABELS` names 'Restored', but the inspector only offers Quarantine, with no confirm dialog and a hard-coded reason 'Held for review' written into the audit ledger. | code |
| major | `src/routes/materials.tsx:232-248` | Receive-lot mutation has no `onError`. A refused receive (wrong state, permission, concurrency) leaves the dialog open with no toast and no error, so the user sees a silent no-op. | code |
| minor | `src/components/v3/materials/materials-data.ts:180-200` | Tab count labels/counts are page-scoped while the header shows the server total: `counts` is computed from the fetched page (limit 200) but `ListHeader total={page.data?.total}`. With >200 lots the tab counts and footer understate. | needs live check |
| minor | `src/components/v3/materials/materials-data.ts:94` | The expiring tab is labelled "Expiring in 30 days", but per-lot `expiry_warning_days` overrides the 30-day default in `reagentAttention`, so a lot can appear/disappear from 'Expiring in 30 days' on a different window. | code |
| minor | `src/routes/materials.tsx:417-418` | The Quarantine button's disabled state is decided by string-matching the display label (`sel.status.label.startsWith('Quarantine')`) rather than the status code; an expired lot (label 'Expired…') keeps the button enabled and no confirmation/undo is offered. | code |
| minor | `src/routes/materials.tsx:464-471` | The 'No replacement lot' block always asserts "Experiments cannot reference an expired lot." regardless of whether the selected lot is expired or even in stock — a claim about a state the lot may not be in. | code |

<details><summary>Evidence</summary>

- `src/lib/reagent-data.ts:607-609` — `?source_record_id=in.(select id from api.records where identifier=eq.${encodeURIComponent(identifier)})&link_type=eq.material...` — PostgREST `in.(...)` is a value list, not a SQL expression.
- `src/routes/materials.tsx:165-181,413-423` — `recordReagentMovement(..., { operation:'quarantine', quantityDelta:0, reason:'Held for review', ... })`; the only action buttons are `Register replacement lot` and `Quarantine`; grep for `operation: 'restore'` in src finds no caller.
- `src/routes/materials.tsx:232-248` — `const receive = useMutation({ mutationFn: (...) => recordReagentMovement(...), onSuccess: () => { ...; toast('Lot received'); setReceiveOpen(false) } })` — no `onError` key.
- `src/components/v3/materials/materials-data.ts:180-200` — `fetchReagentsPage(client, EMPTY_QUERY)` (pageSize 200) and `const counts = ...rows.filter(...)`, while `total: fetchReagentsCount`.
- `src/components/v3/materials/materials-data.ts:94` — `expiring: 'Expiring in 30 days'` vs `const warningDays = reagent.expiryWarningDays ?? DEFAULT_EXPIRY_WARNING_DAYS` (30).
- `src/routes/materials.tsx:417-418` — `disabled={quarantine.isPending \|\| sel.status.label.startsWith('Quarantine')}`
- `src/routes/materials.tsx:464-471` — `replacementLink.data ? ... : 'Experiments cannot reference an expired lot.'`

</details>

#### Templates (7 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `/templates, /templates/$templateId` | The template authoring/editing affordances the design's editor carries do not exist: the board has no "New template" action and the Sections view is explicitly read-only (no add/move/reorder/parameter editing). The `/sheets/new` "From a template" start tile therefore leads to a catalogue the user cannot extend. | needs live check |
| major | `/templates/$templateId/in-use` | The "some records aren't listed" notice is driven solely by the `?state=denied` URL flag, never by the actual row set: it can claim records are hidden when none are, and stays silent when RLS really does hide records without the param. | needs live check |
| major | `/templates/$templateId/versions` | `?state=denied` shows a "View only. Only template owners and QA can publish or retire versions." notice, yet the Publish and Retire buttons still render and open their dialogs for draft/published rows — the view-only claim is not enforced or even reflected in the affordances. | needs live check |
| minor | `/templates/$templateId` | The Sections tab count uses the newest version (which may be an unpublished draft) while the Sections view renders the published version — the tab badge and the table can disagree on section count. | code alone is conclusive. |
| minor | `/templates/$templateId` | A failed template query renders as "Template not found" rather than a load error, so a network/permission failure is reported as a missing resource. | needs live check |
| minor | `/templates/$templateId/in-use` | Per-version and overall record counts come from a single `records` query capped at `limit=200`, so the "Total" column and the staleness notice undercount in workspaces with more in-use records than the cap. | code alone is conclusive. |
| nit | `/templates, /models` | The list footer reports `{visible.length} of {counts[tab]}` but `counts[tab]` ignores the active search, so it reads e.g. "2 of 10 active" while a query is filtering — the denominator is the unfiltered tab size. | code alone is conclusive. |

<details><summary>Evidence</summary>

- `/templates, /templates/$templateId` — src/routes/templates.tsx:110-119 `ListHeader` has no action slot; src/routes/templates/$templateId/index.tsx:22-24 comment: "Editing is deferred; the configuration is shown as stored"; src/routes/sheets/new.tsx:47-53 links "From a template" to `/templates`.
- `/templates/$templateId/in-use` — src/routes/templates/$templateId/in-use.tsx:47-50 validates `state` only as `'denied' \| undefined`; 189-195 renders `You can see {rows.length} record… ask the project lead for access` off `state === 'denied'` alone.
- `/templates/$templateId/versions` — src/routes/templates/$templateId/versions.tsx:159 `denied = search.state === 'denied'`; 248-252 renders the Notice only; 371-381 renders `Publish v{n}…` for any draft and 386-392 renders `Retire v{n}…` — neither condition references `denied`.
- `/templates/$templateId` — src/routes/templates/$templateId.tsx:91 `count: latest?.configuration.placements.length` (latest = highest version); src/routes/templates/$templateId/index.tsx:37-39 `shownVersion` prefers `published`.
- `/templates/$templateId` — src/routes/templates/$templateId.tsx:44-55 `if (!t) … title={template.isLoading ? 'Loading template…' : 'Template not found'}` — no `isError` branch.
- `/templates/$templateId/in-use` — src/components/v3/templates/templates-data.ts:206 `…&limit=200` in `useTemplateUsers`; `countTemplateUse`/`inUseStaleness` aggregate that capped array (in-use.tsx:79-86, :99-104).
- `/templates, /models` — src/routes/templates.tsx:293-296; same pattern src/routes/models.tsx:281-284.

</details>

#### Analysis studio › export (3 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/routes/analysis/new.tsx:1186-1205 (PNG) and 1419-1423` | The Export panel is shown in all three modes, but the SVG anchor is `document.querySelector('[data-analysis-chart]')`, which does not exist in Analyse/Compare mode. Exporting SVG then writes a file containing only an HTML comment; exporting PNG throws in rasteriseSvgToPng and the rejection is unhandled (doExport has no try/catch), so the user sees nothing. | needs live check |
| major | `src/routes/analysis/new.tsx:1190-1198; src/lib/analysis-studio-data.t…` | The Light/Dark theme setting cannot change the export: the PNG background branch is `settings.theme === 'dark' ? 'opaque' : 'opaque'` (both identical, and rasterise always fills white), and the SVG path only sets a `data-theme="dark"` attribute with no colour effect. | code-only |
| major | `src/routes/analysis/new.tsx:1237-1300; src/lib/analysis-studio-data.t…` | The 'Include provenance metadata' checkbox is only honoured by the JSON export. `exportDataCsv` never receives settings and emits no provenance header; `exportChartSvg` always stamps the provenance comment regardless of the checkbox. Turning the box off has no effect on CSV or SVG. | code-only |

<details><summary>Evidence</summary>

- `src/routes/analysis/new.tsx:1186-1205 (PNG) and 1419-1423` — `doExport` async called from `onClick={doExport}` with no catch; exportChartSvg returns `<!-- … no chart rendered at export time -->` when svgEl is null.
- `src/routes/analysis/new.tsx:1190-1198; src/lib/analysis-studio-data.t…` — `background: settings.theme === 'dark' ? 'opaque' : 'opaque'`; exportChartSvg `if (settings.theme === 'dark') root.setAttribute('data-theme','dark')`.
- `src/routes/analysis/new.tsx:1237-1300; src/lib/analysis-studio-data.t…` — `content = exportDataCsv(materialised)` (no settings arg); `exportChartSvg(svgRef.current, settings, provenance)` ignores `settings.includeProvenance`.

</details>

#### Project files tab (3 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `/projects/$projectId/files` | The Files route is orphaned: no tab or link anywhere reaches it (the header tabs are Overview/Milestones/Experiments/Samples/Datasets/Folders/Members/Settings). The feature is unreachable by UI. | code-only |
| major | `/projects/$projectId/files` | "Uploaded by" renders the raw user uuid, not a name. | code-only |
| major | `/projects/$projectId/files` | Files read is capped at 200 with no paging and no "showing 200 of N" notice, so a project with more files silently drops the rest. | code-only |

<details><summary>Evidence</summary>

- `/projects/$projectId/files` — src/routes/projects/$projectId/files.tsx:24 route only; grep for `/projects/$projectId/files` finds only routeTree.gen.ts and its own test; src/routes/projects/$projectId.tsx:126-166 tabs omit Files.
- `/projects/$projectId/files` — src/routes/projects/$projectId/files.tsx:83 `uploadedBy: record.created_by_user_id` and :155 `<TableCell>{file.uploadedBy ?? '—'}</TableCell>`.
- `/projects/$projectId/files` — src/routes/projects/$projectId/files.tsx:64-65 `...limit=200&select=...`; no count/pagination in the component.

</details>

#### Shell / notification bell (3 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/components/v3/shell/app-shell.tsx:230` | Bottom-tab Inbox unread badge is computed from the server-provided `data.notifications` array and is completely independent of the bell popover's local read state, so opening the bell and pressing "Mark all read" never clears the phone badge during the session. | needs live check |
| major | `src/components/v3/shell/app-shell.tsx:598-635` | "Mark all read" performs no write — it only flips a local `read` boolean. Unread is re-derived from the SSR snapshot on every reopen, so the action has no persistent effect and the rows revert to unread on reload. A persistence path (`mark_notifications_read` RPC) already exists and is used by the legacy bell. | needs live check |
| major | `src/components/v3/shell/app-shell.tsx:637-653` | Every notification row hard-codes `to="/inbox"`, discarding the per-item `n.to` target. The server computes a typed target (pipeline-run/dataset/sample/sheet/review) in shell-chrome.server.ts:notificationTarget, so clicking a pipeline-failure notification lands on the Inbox instead of the run. | code |

<details><summary>Evidence</summary>

- `src/components/v3/shell/app-shell.tsx:230` — `unread={data.notifications.filter((n) => n.unread).length}` (230) vs `const unread = read ? 0 : items.filter(...)` (600) in a separate component.
- `src/components/v3/shell/app-shell.tsx:598-635` — `const [read, setRead] = useState(false)` (line 599); `onClick={() => setRead(true)}` (632); compare `markNotificationsRead` -> `client.rpc('mark_notifications_read'…)` in src/lib/notifications-data.ts:63-65.
- `src/components/v3/shell/app-shell.tsx:637-653` — `<Link key={n.id} to="/inbox" …>` (639-641); target computed at src/lib/shell-chrome.server.ts:90-98 and never read.

</details>

#### Models (11 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `/models/$modelId/records/$recordId` | The "Integrations" panel unconditionally states "No integration has written to this record yet." — a hard-coded claim with no data source, so it is shown even when the History section above lists integration-sourced entries. | code alone is conclusive |
| major | `/models/$modelId/records/new` | Rules with a `block` effect are displayed inline ("Blocked: <message>") but are excluded from `canSubmit`, which only checks field errors/title/project — so the Create button stays enabled for a form the UI just said is blocked. | needs live check |
| minor | `/models` | The list's "Fields"/"Datasets" counts are computed from the newest version, which may be an unpublished draft, so the board can describe draft fields for a model whose datasets are on a published version. | code alone is conclusive. |
| minor | `/models/$modelId` | Same false-negative state on the model frame: a definition fetch error renders "Model not found" (and the record-model variant does the same for its key). | needs live check |
| minor | `/models/$modelId/edit` | "Discard draft" is disabled only by `denied \|\| saving`, not by `locked`. While a draft is awaiting approval the editor otherwise blocks all edits, but the destructive discard remains clickable and only fails server-side. | needs live check |
| minor | `/models/$modelId/edit` | The editor's `Save` shows "Saved · revision N" but never blocks a save whose field contract the server will reject until after the round-trip; there is no inline pre-check (`validateDraft` covers only client rules) so an invalid pattern/unit is only reported after an autosave failure. | needs live check |
| minor | `/models/$modelId/records/$recordId` | Status is shown two ways on one page: the header badge maps the status via `pickerStatus`, while the Details list prints the raw stored status code. | code alone is conclusive. |
| minor | `/models/$modelId/records/new` | When the workspace has no projects, the Project field is not rendered (only shown when `projects.length > 1`) and `selectedProject` is empty, so Create is permanently disabled with no explanation of the missing prerequisite. | needs live check |
| minor | `/models/$modelId/relations` | Removing a relation rule has no confirmation step (errors are surfaced, but the destructive action is immediate). | needs live check |
| minor | `/models/$modelId/rules` | Removing a rule is a bare `onClick` with no confirmation, and the mutation has no `catch`, so a refused remove is silent (the button just re-enables and the row stays). | needs live check |
| minor | `/models/$modelId/versions` | The per-row Publish button only renders when `policy.isSuccess`; if the workspace-policy query fails, no Publish button appears and no error is shown, so publishing silently disappears. | needs live check |

<details><summary>Evidence</summary>

- `/models/$modelId/records/$recordId` — src/components/v3/models/record-model-record.tsx:203-209 — the paragraph text is a literal; nothing queries integration writes.
- `/models/$modelId/records/new` — src/components/v3/models/record-model-new.tsx:72-76 `canSubmit` omits `validation.blocks`; :223-233 renders blocks in the list; :248 `disabled={!canSubmit}`.
- `/models` — src/components/v3/models/models-data.ts:100-130 `buildModelRows` uses `list.at(0)` (sorted desc) for `fieldCount`/`datasetCount`; src/routes/models.tsx:178-196 renders them unlabelled as the model's numbers.
- `/models/$modelId` — src/routes/models/$modelId.tsx:63-71 ("Loading model…" : "Model not found") and :230-245 ("Model not found" / "No model …") with no error check.
- `/models/$modelId/edit` — src/routes/models/$modelId/edit.tsx:865-871 `disabled={denied \|\| saving}` vs the `locked` guard used for every field/Add-field control (:740-760, :370-375).
- `/models/$modelId/edit` — src/routes/models/$modelId/edit.tsx:392-405 `savedState` derives from `dirty`/`saveState`, and the inspector writes arbitrary `validation.pattern`/unit text (:520-560) with no client validation.
- `/models/$modelId/records/$recordId` — src/components/v3/models/record-model-record.tsx:149 `['Status', record.status]` vs :99-101 `pickerStatus(record.status)` in the header.
- `/models/$modelId/records/new` — src/components/v3/models/record-model-new.tsx:61 `selectedProject = projectId \|\| projects[0]?.id \|\| ''`; :198-217 renders the Project select only `if (projects.length > 1)`; :248 disables on `!canSubmit`.
- `/models/$modelId/relations` — src/routes/models/$modelId/relations.tsx:184-190 `onClick={() => remove(rule.id)}`; no dialog introduced before the call.
- `/models/$modelId/rules` — src/routes/models/$modelId/rules.tsx:156-163 `remove()` has only try/finally; :204-209 `onClick={() => remove(rule.id)}` with no confirm dialog.
- `/models/$modelId/versions` — src/routes/models/$modelId/versions.tsx:279-292 gates on `policy.isSuccess` without an isError branch or notice.

</details>

#### Sheets (11 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| blocker | `/sheets/$sheetId` | Editability is keyed off the `projectId` search param, not the instance's own project. Every canonical deep link (`sheetPath` → `/sheets/<id>` with no search) from Recents, Favourites, search results and comment deep-links opens the sheet read-only, with no message explaining why editing is gone. | verified live |
| major | `/sheets/$sheetId (record picker)` | A failed Record search in the sheet's picker is swallowed: `SheetRecordPicker` accepts an `error` prop but the workspace never passes `search.error`, so an RPC failure renders as the ordinary "No <model> Records match your search." empty state. | needs live check |
| minor | `/sheets/$sheetId` | A returned promotion offers no "Keep local" dismissal (component supports it, caller never passes it), and a pending/approved promotion is invisible on the sheet — the only promotion UI is the returned banner. | needs live check |
| minor | `/sheets/$sheetId` | Link/Create record writes from the sheet have no `onError`, so a refused `linkSheetRecordReference`/`createAndLinkSheetRecord` leaves no feedback (the picker closes as if it worked). | needs live check |
| minor | `/sheets/$sheetId` | Deleting a local row fires without handling rejection: `handleRowsRemoved` calls `void deleteLocalRowAtRef.current(...)` and the async `deleteLocalRowAt` has no catch, so a failed delete is silent and the row reappears only after a refetch. | needs live check |
| minor | `/sheets/$sheetId` | Local row/column deletion ("Delete local row", "Retire local column") and "Clear contents" run with no confirmation, though retiring a column changes what the sheet can hold. | needs live check |
| minor | `/sheets/$sheetId (Sources panel)` | Adoption/upgrade/materialise/extract-and-publish are global, mutating actions invoked from a collapsed panel with no confirmation; "Extract and publish" publishes a Definition and "Apply materialise" writes a Dataset on a single click. | needs live check |
| minor | `keyboard model` | "Next cell" only moves right and is deactivated at the last column (`column + 1 < columnCount`), with no wrap to the next row; a keyboard user editing the rightmost column hits a dead end. | needs live check |
| nit | `/sheets/$sheetId` | `addCalculation` clears the formula input but leaves `formulaLabel`, so the next calculation reuses the previous label unless the user retypes it. | code alone is conclusive. |
| nit | `/sheets/$sheetId` | `SheetPromote` resets the reason but not the chosen target Dataset after a successful request; in its default trigger mode (dialog stays mounted) reopening preselects the previous dataset. | code alone is conclusive. |
| nit | `scientific sheet export` | `ScientificTransferPanel` declares `readOnly` and `onImported` props, but neither is destructured or used; the export button disables itself above 5000 rows with no explanation of the threshold. | code alone is conclusive. |

<details><summary>Evidence</summary>

- `/sheets/$sheetId` — src/routes/sheets/$sheetId.tsx:71-72 computes `instanceProjectId`, but line 157-159 passes `projectId={projectIdParam ?? null}` and `readOnly={!projectIdParam}`; `src/lib/navigation.ts:22` `sheetPath` emits `/sheets/<id>` with no `projectId`; `useRecentViewTracking` and FavouriteToggle deep-links follow the same shape.
- `/sheets/$sheetId (record picker)` — src/components/sheet/canonical-sheet-workspace.tsx:2134-2143 passes `results/loading/onSearch/onSelect` only; src/components/sheet/sheet-record-picker.tsx:34-41 declares `error?` and renders it at :74-84.
- `/sheets/$sheetId` — src/components/sheet/canonical-sheet-workspace.tsx:1941-1953 passes only `onEditAndResubmit`; src/components/sheet/promote-rejected.tsx:52-60 hides the whole banner unless `state === 'returned'` and only offers `onKeepLocal` when provided.
- `/sheets/$sheetId` — src/components/sheet/canonical-sheet-workspace.tsx:1036-1076 (`link`) and :1078-1110 (`create`) define only `onSuccess`; :2159 `link.mutate(result.id)` / :2171 `create.mutate()` then close the picker.
- `/sheets/$sheetId` — src/components/sheet/canonical-sheet-workspace.tsx:1125-1127 `void deleteLocalRowAtRef.current(rowIndex)`; :841-857 mutates with no error handling (contrast the catch around `persistLocalCells` at :1220-1227).
- `/sheets/$sheetId` — src/components/sheet/canonical-sheet-workspace.tsx:1465-1484 contextMenu entries call `deleteRowRef.current()`/`deleteColumnRef.current()` with no dialog; `deleteSelectedColumn` (:860-866) retires immediately.
- `/sheets/$sheetId (Sources panel)` — src/components/sheet/canonical-sheet-lifecycle-panel.tsx:386-421 (adopt), :453-472 (extract/publish), :486-506 (materialise) — each `onClick` calls the mutation directly.
- `keyboard model` — src/components/shortcuts/sheet-keyboard-shortcuts.tsx:62-64 `return !editing && !event.shiftKey && column + 1 < columnCount`; :44-48 always does `selectCell(row, column + 1)`.
- `/sheets/$sheetId` — src/components/sheet/canonical-sheet-workspace.tsx:969-972 `setFormula('')` only.
- `/sheets/$sheetId` — src/components/sheet/sheet-promote.tsx:125-127 `setOpen(false); setReason('')` — no `setDefinitionId('')`; state declared at :93.
- `scientific sheet export` — src/components/sheet/scientific-transfer-panel.tsx:31-35 destructures only `table, rows`; :46 `disabled={busy \|\| rows.length > 5000}`; caller passes `readOnly` at src/components/sheet/scientific-sheet-block.tsx:2135-2139.

</details>

#### Samples (detail) (4 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/routes/samples/$sampleId.tsx:296-305` | The quarantined banner's "View release checks" button links to `/samples/$sampleId/measurements`, which renders the Measurements table only — it never shows release checks (`releaseChecks` is only ever rendered as 'Release basis' on the Details tab). Misleading label/destination. | code |
| major | `src/routes/samples/$sampleId.tsx:347-351 and src/routes/samples/$samp…` | "Export lineage" is a fake success: it only toasts 'Export started. You will get a link when it is ready.' with no export request, job or link anywhere. | code |
| minor | `src/lib/samples.tsx:640-646` | History/custody is silently truncated: `fetchSampleEvents` caps at 50 rows and the History tab gives no indication that older events are omitted, so a long-lived sample's audit trail looks complete. | code |
| minor | `src/routes/samples/$sampleId.tsx:318-320` | The Usage tab badge counts cancelled reservations too (`usageCount` = consume events + all reservations, and usage.tsx's `rowCount` is likewise all reservations), so the count overstates live usage. | code |

<details><summary>Evidence</summary>

- `src/routes/samples/$sampleId.tsx:296-305` — banner action render `<Link to='/samples/$sampleId/measurements' ...>View release checks`; measurements.tsx renders only `fetchSampleMeasurements`; `describeReleaseChecks` is used only in index.tsx ('Release basis').
- `src/routes/samples/$sampleId.tsx:347-351 and src/routes/samples/$samp…` — `onClick={() => toast('Export started. You will get a link when it is ready.')}` in both places.
- `src/lib/samples.tsx:640-646` — `?record_id=eq.${recordId}&order=created_at.desc&limit=50`; history.tsx renders `rows.length` as if it were the full count.
- `src/routes/samples/$sampleId.tsx:318-320` — `const usageCount = (events.data ?? []).filter(e => e.operation === 'consume').length + (reservations.data?.length ?? 0)`; usage.tsx `rowCount = withdrawalEvents.length + reservationRows.length` (reservations are not filtered by state).

</details>

#### Pipelines · Runs (3 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/routes/pipelines/$pipelineId/runs/$runId.tsx:100-140` | A running or waiting run cannot be stopped from the UI. `cancelPipelineRun` exists but no surface calls it, so a stuck/waiting run is only escapable by answering its prompt. | code |
| major | `src/routes/pipelines/$pipelineId/runs/$runId.tsx:126-137` | A `waiting` run whose prompt row is missing (or not yet readable) shows the warning banner “This run is waiting for you… it paused at its confirm step” but renders no RunPromptPanel and therefore no control — the page advertises an action it does not offer. | needs live check |
| minor | `src/routes/pipelines/$pipelineId/runs/$runId.tsx:63` | Answering with Skip or Stop still toasts “Answer recorded — the run is resuming.”, which is false for a stop decision. | code |

<details><summary>Evidence</summary>

- `src/routes/pipelines/$pipelineId/runs/$runId.tsx:100-140` — RunPage renders only the prompt answer controls; grep for `cancelPipelineRun` finds src/lib/pipelines/data.ts:151 and data.test.ts, plus the internal executor (pipeline-execute.server.ts:876). No route imports it.
- `src/routes/pipelines/$pipelineId/runs/$runId.tsx:126-137` — Banner renders on `r.status === 'waiting'`; the panel renders only `{prompt ? <RunPromptPanel …/> : null}` and `prompt` is `promptList[promptList.length - 1]`, undefined when the query returns nothing.
- `src/routes/pipelines/$pipelineId/runs/$runId.tsx:63` — `onSuccess: () => { toast('Answer recorded — the run is resuming.') }` — the mutation receives `PipelineRunPromptAnswer` including decision but ignores it.

</details>

#### Pipelines · Triggers (3 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/routes/pipelines/$pipelineId/triggers.tsx:126-132` | Deleting a trigger is destructive and irreversible (a schedule is not re-creatable from the UI, see above) but fires with no confirmation dialog. | code |
| major | `src/routes/pipelines/$pipelineId/triggers.tsx:141-146` | There is no way to create a trigger anywhere in the UI, yet the empty state promises one: “A pipeline runs when someone presses Run now until a trigger is added.” The Runs tab repeats “turn on a trigger in Triggers.” Only Pause/Enable/Delete exist. | code |
| minor | `src/routes/pipelines/$pipelineId/triggers.tsx:99` | The trigger “Spec” column prints the raw jsonb: `JSON.stringify(s.spec)` — a user sees `{"intervalMinutes":60}` rather than a readable schedule, and the column has no empty placeholder when spec is null. | needs live check |

<details><summary>Evidence</summary>

- `src/routes/pipelines/$pipelineId/triggers.tsx:126-132` — `<Button size="sm" variant="quiet" disabled={remove.isPending} onClick={() => remove.mutate(s.id)}>Delete</Button>` — unlike members/access/groups, no ConfirmDialog.
- `src/routes/pipelines/$pipelineId/triggers.tsx:141-146` — triggers.tsx renders only toggle.mutate / remove.mutate; no create control. `createPipelineSchedule` exists (src/lib/pipelines/data.ts:193) but grep shows it is imported only by lib/pipelines/data.test.ts — no route/component calls it.
- `src/routes/pipelines/$pipelineId/triggers.tsx:99` — <TableCell className="mono text-caption">{JSON.stringify(s.spec)}</TableCell>

</details>

#### Scan (3 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/components/v3/scan/scan-data.ts:37,46,81` | Scanned instruments always read "Disconnected". The scanner resolves instrument status from the legacy `connection_status` column, but the registry's connection concept was replaced by `intake_method` (migration 0424) and no product code writes `connection_status` any more (only the legacy `api.update_instrument_connection` RPC, which nothing in src calls). New instruments default to 'disconnected'. | needs live check |
| major | `src/routes/scan.tsx:40-58` | The scan flow swallows lookup failures. `resolve` has `try { … } finally { setBusy(false) }` with no `catch`, and is invoked as `void resolve(raw)`, so a rejected `resolveScanCode` (network/RLS error) produces no message at all — the spinner stops and nothing happens. | code |
| minor | `src/components/v3/scan/scan-data.ts:66-73` | A scanned record's status is always rendered with the neutral 'stored' tone and the raw underscore-replaced status, regardless of the real status, so a consumed/quarantined sample looks the same as an available one. | code |

<details><summary>Evidence</summary>

- `src/components/v3/scan/scan-data.ts:37,46,81` — `?select=${INSTRUMENT_FIELDS}` where INSTRUMENT_FIELDS ends `...instrument_type,connection_status`; status: `row.connection_status === 'connected' ? {tone:'ok',label:'Connected'} : {tone:'stored',label:'Disconnected'}`. grep src for `connection_status` = only scan-data.ts + db/schema.ts.
- `src/routes/scan.tsx:40-58` — `const resolve = async (raw) => { setBusy(true); try { const r = await resolveScanCode(trimmed); setResult(r); ... } finally { setBusy(false) } }`; `onScan={(raw) => void resolve(raw)}`.
- `src/components/v3/scan/scan-data.ts:66-73` — `status: { tone: 'stored', label: row.status.replace(/_/g, ' ') }` in `toRecordTarget`.

</details>

#### Analysis view (read-only) (2 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/routes/analysis/$analysisId.tsx:150-154` | The status pill says 'Up to date' whenever `status` is null, i.e. while the canonical source check is still loading or if it errored. A stale/errored analysis is presented as up to date. | code-only |
| major | `src/routes/analysis/$analysisId.tsx:162-167` | 'Edit in studio' navigates to /analysis/new with no search params, so the studio auto-selects the first dataset and builds a fresh default spec — it does not open the analysis being viewed. There is also no URL form (`?view=`) to load a saved view into the studio. | code-only |

<details><summary>Evidence</summary>

- `src/routes/analysis/$analysisId.tsx:150-154` — `<Status tone={status?.state === 'stale' ? 'warn' : 'ok'}>{status?.state === 'stale' ? 'Sources changed' : 'Up to date'}</Status>` with no loading branch.
- `src/routes/analysis/$analysisId.tsx:162-167` — `<Link to="/analysis/new" className={buttonVariants({ variant: 'primary' })}>Edit in studio</Link>` — no `search`; studio only ever sets selectedViewId via the in-panel Load button.

</details>

#### Experiments list (4 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `/experiments` | The list read is capped at 300 with no paging and no "showing 300 of N" indicator, so a busy workspace silently loses experiments (and the "N of M" footer uses the truncated total). | code-only |
| minor | `/experiments` | `?group=project\|owner` is validated and drives grouped rendering, but no control anywhere sets it — an unreachable view. | code-only |
| minor | `/experiments` | "Started" column is populated from created_at (record creation), so it is not the experiment start date the label implies. | code-only |
| minor | `/experiments` | When the user can access no project the empty state shows the no-access copy, yet the header count still prints the total number of experiments loaded — implying visibility the list denies. | needs live check |

<details><summary>Evidence</summary>

- `/experiments` — src/components/v3/experiments/experiments-data.ts:98 `...order=updated_at.desc&limit=300`; footer src/routes/experiments.tsx:445-449 uses rows.length.
- `/experiments` — src/routes/experiments.tsx:77,82-85 validateSearch group; :188-201 groups rows; grep finds no UI setting `group`.
- `/experiments` — src/components/v3/experiments/experiments-data.ts:~78 `started: row.created_at.slice(0, 10)`.
- `/experiments` — src/routes/experiments.tsx:158 `<span className="num ...">{rows.length}</span>`; no-access branch at :397-401.

</details>

#### Projects list (4 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `/projects` | Empty-state "New project" is a dead control for users without record.create: it calls onNew (setSearch new:true) but the dialog only opens when canCreate is true, so the click does nothing. | code-only |
| minor | `/projects` | Row checkboxes and a "N selected" footer exist, but there is no bulk action anywhere — selection is a dead affordance. | code-only |
| minor | `/projects` | Sort by "ID" sorts descending (Z→A) while Name sorts ascending — inconsistent and counter to the label. | code-only |
| nit | `/projects` | Group header cell over-spans by one column, so the group band runs one cell past the table's last column. | needs live check |

<details><summary>Evidence</summary>

- `/projects` — src/components/v3/projects/projects-page.tsx:801 `<Button variant="primary" onClick={onNew}>New project</Button>` vs projects-page.tsx:719 `open={canCreate && !!search.new}`. Header button at :214 is guarded by `disabled={!canCreate}`, the empty-state one is not.
- `/projects` — src/components/v3/projects/projects-page.tsx:625-640 checkbox column; footer shows only `{checked.size} selected` (~:636), no archive/export/move control wired to `checked`.
- `/projects` — src/components/v3/projects/projects-page.tsx:176-178 `sort === 'id' ? b.id.localeCompare(a.id)`.
- `/projects` — src/components/v3/projects/projects-page.tsx:196 `const colSpan = 5 + cols.length`; the header is checkbox + ID + Project + cols + Status = 4 + cols.length columns (pages 625-700).

</details>

#### Protocols (4 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/components/v3/protocols/protocol-version-training.tsx:18` | Two contradictory training models, and the design's is dead code. `ProtocolVersionTraining` (per-frozen-version acknowledgement, 'A new version requires a new acknowledgement') is referenced only from stories/tests; the live Training tab uses `protocol_training` with record-level statuses Trained/Required/Expired via `record_protocol_training` (drizzle 0271), which has no version linkage at all. | code |
| minor | `src/routes/protocols.tsx:49,79-81` | Tab says "Retired" while the status chip for the same rows says "Archived" (`protocolStatus('archived') -> 'Archived'`). | code |
| minor | `src/routes/protocols/$protocolId.tsx:381-390` | The Training tab claims 'experiments should only start from a version their owner is trained on', but nothing enforces or surfaces that at experiment start (training is record-level, unversioned), so the statement is aspirational copy. | code |
| minor | `src/routes/protocols/$protocolId.tsx:445-465` | Record-training dialog initialises the person before members load: `useState(members.at(0)?.user_id ?? '')` runs once, so when the workspace-member RPC resolves after first paint the select stays blank and Save is disabled until the user re-picks. | needs live check |

<details><summary>Evidence</summary>

- `src/components/v3/protocols/protocol-version-training.tsx:18` — grep `ProtocolVersionTraining` = component, its test, and protocols.stories.tsx only; protocols/$protocolId.tsx TrainingTab uses `client.list('protocol_training', ...)` + `rpc('record_protocol_training', ...)`.
- `src/routes/protocols.tsx:49,79-81` — `retired: 'Retired'` in tabLabel; `case 'archived': return { tone:'stored', label:'Archived' }`.
- `src/routes/protocols/$protocolId.tsx:381-390` — EmptyState body text; no reader of `protocol_training` outside this tab (grep).
- `src/routes/protocols/$protocolId.tsx:445-465` — `const [userId, setUserId] = useState(members.at(0)?.user_id ?? '')` where `members = members.data ?? []` from an async query.

</details>

#### Datasets › Compare tab (3 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/routes/datasets/$datasetId/compare.tsx:270-281` | While the diff is still loading (or has errored) the page renders 'No differences between these snapshots.' and all five change counters as 0 — a false empty state before/without data. | needs live check |
| minor | `src/routes/datasets/$datasetId/compare.tsx:296-300` | The compare table identifies snapshots and fields by raw ids (rowId.slice(0,8), fieldId.slice(0,8), footer prints the two UUIDs), and the page openly admits labels are missing. | code-only |
| minor | `src/routes/datasets/$datasetId/compare.tsx:99-100` | Nothing stops choosing the same snapshot for From and To; the RPC compares a version to itself and the UI reports 'No differences' rather than preventing the pointless comparison. | code-only |

<details><summary>Evidence</summary>

- `src/routes/datasets/$datasetId/compare.tsx:270-281` — `entries`/`data` are undefined until load; render falls to `<Muted>No differences between these snapshots.</Muted>` with no `diff.isLoading` guard, and counters use `data?.counts.added ?? 0`.
- `src/routes/datasets/$datasetId/compare.tsx:296-300` — `Comparing {from} with {to}. Field names show their ids until the schema label join is added.` plus `{entry.fieldId.slice(0, 8)}` and `{r.rowId.slice(0, 8)}`.
- `src/routes/datasets/$datasetId/compare.tsx:99-100` — `const to = search.to ?? list.at(0)?.id; const from = search.from ?? list.at(1)?.id` — both selects list all versions with no exclusion of the other side.

</details>

#### Pipelines · List (3 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/routes/pipelines.tsx:148-160` | There is no “New pipeline” affordance; the only header action is “Agent operations”. `createPipelineDefinition` is unreachable from the product. | code |
| minor | `src/routes/pipelines.tsx:129,321` | The footer claims “1 selected” whenever a row happens to be highlighted, because `sel` falls back to `visible.at(0)` — the first pipeline is auto-selected before the user selects anything. | needs live check |
| minor | `src/routes/pipelines.tsx:63-68,240` | Row click sets local `selected` state only; the validated `selected` search param is read but never written, so the inspector selection is not shareable/deep-linkable and is lost on refresh — inconsistent with the rest of the page's URL-driven state (q, tab). | code |

<details><summary>Evidence</summary>

- `src/routes/pipelines.tsx:148-160` — ListHeader actions = one Button to /pipelines/agents; grep for `createPipelineDefinition` shows only src/lib/pipelines/data.ts:26 and data.test.ts / db seed.
- `src/routes/pipelines.tsx:129,321` — `const sel = visible.find(...) ?? visible.at(0)` then `<ListFooter right={sel ? '1 selected' : undefined}>`.
- `src/routes/pipelines.tsx:63-68,240` — `validateSearch` reads `selected`; `onClick={() => setSelected(p.id)}` never calls `navigate`.

</details>

#### Schedule / booking dialog (3 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/components/v3/schedule/book-dialog.tsx:65-67` | Bookings are always written with `timezone: 'UTC'` and wall-clock times appended with `Z`, ignoring the workspace timezone. Home and the Schedule grid then disagree (Home converts to workspace TZ), so a booking made for 09:00 can display at a different time on Home. | needs live check |
| minor | `src/components/v3/schedule/book-dialog.tsx:56-60` | No client validation that the end time is after the start (or that a date is set); a reversed or empty range is submitted and only refused server-side. | code |
| minor | `src/components/v3/schedule/book-dialog.tsx:69-72` | After a successful booking the dialog resets `title` and `resourceId` but leaves `date`/`start`/`end`, and `date` is initialised from `defaultDate` only on first mount — so the next booking silently reuses stale times, and the prop-derived default never updates as the user changes week/day. | code |

<details><summary>Evidence</summary>

- `src/components/v3/schedule/book-dialog.tsx:65-67` — `startsAt: \`${date}T${start}:00.000Z\``, `endsAt: \`${date}T${end}:00.000Z\``, `timezone: 'UTC'` (65-67) vs Home `toLocaleTimeString('en-GB', { timeZone })` (index.tsx:760-764).
- `src/components/v3/schedule/book-dialog.tsx:56-60` — Submit guard checks only `!resourceId \|\| !title.trim()` (56-59); start/end are free `type=time` inputs (120-129).
- `src/components/v3/schedule/book-dialog.tsx:69-72` — `setTitle('')`/`setResourceId('')` (71-72) but no date/start/end reset; `const [date, setDate] = useState(defaultDate)` (46); `defaultDate={view === 'day' ? anchor : addDays(today, 3)}` (schedule.tsx:184).

</details>

#### Search / command palette (3 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/components/v3/search/search-palette.tsx:145-156` | The palette's `executeSearch` promise has no `.catch`; a failing search leaves `res === null`, so the "No matches" branch (`res !== null && …`) never shows and the user sees an empty results box, plus an unhandled rejection. No error/retry state exists. | code |
| minor | `src/components/v3/search/search-palette.tsx:137-155` | While the debounced query is in flight `res` remains from the prior query or null, and there is no "searching" state — an empty listbox is shown with no progress indication. | needs live check |
| minor | `src/components/v3/search/search-palette.tsx:82-96 (scope) + 341` | With a project scope selected the palette client-filters results (`filterBySearchScope`); if the scope removes all rows the palette shows the generic "No matches for …" with no hint that the scope caused it and no way to clear the scope from that state. | needs live check |

<details><summary>Evidence</summary>

- `src/components/v3/search/search-palette.tsx:145-156` — `void executeSearch(notebookDataClient, {…}).then((rows) => { if (live) { setRes(rows) … } })` (145-155); empty-state guard at ~340-345 requires `res !== null`.
- `src/components/v3/search/search-palette.tsx:137-155` — `setRes(null)` on empty term (139); fetch only sets `res` on resolution (150-155).
- `src/components/v3/search/search-palette.tsx:82-96 (scope) + 341` — `scoped = filterBySearchScope(items, scope === SEARCH_SCOPE_ALL ? undefined : scope)` (208-214); empty state text at 341-345.

</details>

#### Search / results page (3 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/routes/search.tsx:337` | The search query has no error branch. If the `search` RPC fails, `results.length === 0` and `!query.hasNextPage`, so the page renders the "No matches" state and a did-you-mean — a failing search is reported as a genuine miss with no retry. | needs live check |
| minor | `src/routes/search.tsx:183-190` | The search form submits via `navigate({ …, replace: true })`, replacing history, so the browser Back button cannot return to the previous query. (Same replace is used for facet toggles at 190-195.) | needs live check |
| minor | `src/routes/search.tsx:328-330` | "Sort: Relevance" is styled like a control but is plain text with no menu or link — a dead affordance implying sort is changeable. | code |

<details><summary>Evidence</summary>

- `src/routes/search.tsx:337` — `{!query.isLoading && results.length === 0 && !query.hasNextPage ? <NoResults …>}` (337-338); the only query-level flags used are `isLoading`/`isFetchingNextPage` (378-385).
- `src/routes/search.tsx:183-190` — `setSearch = (patch) => void navigate({ to: '/search', search: (s) => ({...s, ...patch}), replace: true })` (183-190).
- `src/routes/search.tsx:328-330` — `<span className="text-label text-fg-muted max-md:hidden">Sort: Relevance</span>` (328-330).

</details>

#### Shell / workspace switcher (3 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/components/v3/shell/app-shell.tsx:500-501` | The workspace switcher trigger is `hidden … sm:flex` and is not offered anywhere else (the mobile menu Sheet renders only SideNav). Below the sm breakpoint a phone user has no way to see or change the active workspace. | needs live check |
| minor | `src/components/v3/shell/app-shell.tsx:149-156` | A refused workspace switch is swallowed and `router.invalidate()` still runs, so the menu checkmark/selection does not move and the user gets no error — the click appears to do nothing. | needs live check |
| minor | `src/components/v3/shell/app-shell.tsx:534` | The workspace menu's only non-membership entry is a permanently disabled "Create workspace" item with no explanation or route — a dead affordance. | code |

<details><summary>Evidence</summary>

- `src/components/v3/shell/app-shell.tsx:500-501` — `className="hidden max-w-52 gap-1.5 sm:flex"` (501); Sheet at 232-242 contains only `<SideNav>`.
- `src/components/v3/shell/app-shell.tsx:149-156` — `try { await setActiveWorkspace(...) } catch { /* keep the current workspace if the switch is refused */ } router.invalidate()` (150-156).
- `src/components/v3/shell/app-shell.tsx:534` — `<DropdownMenuItem disabled>Create workspace</DropdownMenuItem>` (534).

</details>

#### Auth · sign-in (2 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/routes/sign-in.tsx:72-75` | The `next` parameter is validated only with `startsWith('/')`, so a protocol-relative URL such as `//evil.example` passes and is handed to better-auth as `callbackURL`, enabling an open redirect after sign-in. | code |
| minor | `src/routes/sign-in.tsx:145-163` | If the SSO fetch throws or returns no `url`, `sso()` swallows the failure and only re-enables the button — no error message, so the button appears to do nothing. | needs live check |

<details><summary>Evidence</summary>

- `src/routes/sign-in.tsx:72-75` — `next: typeof search.next === 'string' && search.next.startsWith('/') ? search.next : undefined`, then `body: JSON.stringify({ provider: 'github', callbackURL: next ?? '/' })`.
- `src/routes/sign-in.tsx:145-163` — `catch { /* fall through to re-enable the button */ }` then `setRedirecting(false)`; no error state rendered.

</details>

#### Datasets › Rows grid (2 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/routes/datasets/$datasetId/rows.tsx:90-95, 284-287` | The grid fetches only the first 100 rows with no paging/load-more, but the footer prints '{visible} of {totalCount} rows' as if the whole set were reachable; search and the flagged filter only search/filter those first 100 rows. | code-only |
| minor | `src/routes/datasets/$datasetId/rows.tsx:205-206` | 'Only flagged rows (N)' counts flags, not rows; the number can exceed the number of rows the filter will show, contradicting the label. | code-only |

<details><summary>Evidence</summary>

- `src/routes/datasets/$datasetId/rows.tsx:90-95, 284-287` — `p_limit: 100, p_offset: 0` with no infinite query or pagination control; footer `{visible.length} of {payload?.totalCount ?? 0} rows`.
- `src/routes/datasets/$datasetId/rows.tsx:205-206` — `Only flagged rows ({flags.length})` where `flags` is the per-value flag list.

</details>

#### Experiment results tab (2 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `/experiments/$expId/results` | Dataset results are located by calling `dataset_list_summary` with no arguments and filtering by display id in the browser — the exact anti-pattern the project-list module forbids ("never by filtering a page of results in the browser") and it can silently omit datasets past the RPC's default page. | code-only |
| minor | `/experiments/$expId/results` | Section naming is misleading: the section titled "Figure" lists analyses and "Table" lists datasets; datasets are matched by link `target_identifier` against `display_id`, and analyses filter on either target_kind or link_type, so membership is fuzzy. | code-only |

<details><summary>Evidence</summary>

- `/experiments/$expId/results` — src/routes/experiments/$expId/results.tsx:92-97 `rpc('dataset_list_summary', {})` then `.filter(d => d.display_id && datasetIds.includes(d.display_id))`; contrast project-lists.ts:1-25 doctrine comment.
- `/experiments/$expId/results` — src/routes/experiments/$expId/results.tsx:100 `<Section title="Figure">` renders analyses; :124 `<Section title="Table">` renders datasets; :63-67 id selection.

</details>

#### Pipelines · Steps (2 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/routes/pipelines/$pipelineId/steps.tsx:142-146` | A pipeline with no versions shows a dead-end notice whose copy is also wrong: “A pipeline needs a published version before its steps can be edited.” The editor works from a draft (or creates one), and there is no control to create the first version, so the page is unusable for a fresh definition. | code |
| minor | `src/routes/pipelines/$pipelineId/steps.tsx:56,186-204` | The file comment says the editor edits “description, SQL transform, output dataset and inputs”, but inputs are read-only text and there is no add/remove/parameter UI or output-mode choice — the page can only edit description, SQL and dataset name. | code |

<details><summary>Evidence</summary>

- `src/routes/pipelines/$pipelineId/steps.tsx:142-146` — `if (!source)` renders only the Notice; `source = draft ?? current` and `saveDraft` (which could call create_pipeline_definition_version) is below this early return, so it never renders.
- `src/routes/pipelines/$pipelineId/steps.tsx:56,186-204` — `{inputs.map((i) => (<li>{i.name} …})` with no inputs; only `<Field label="Dataset name">` under Output; no mode control.

</details>

#### Project folders (2 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `/projects/$projectId/folders` | canEdit is a tautology — `project?.leadUserId ? true : false` is true for any project that has a lead — so every viewer sees New folder and the Move control; the intent was almost certainly comparing to the current user. | code-only |
| minor | `/projects/$projectId/folders` | Sidebar indentation only distinguishes one level (`parent_id ? 1 : 0`), so grandchildren overlap their parents, even though New folder lets you nest under any top-level folder. | needs live check |

<details><summary>Evidence</summary>

- `/projects/$projectId/folders` — src/routes/projects/$projectId/folders.tsx:115 `const canEdit = project?.leadUserId ? true : false`.
- `/projects/$projectId/folders` — src/routes/projects/$projectId/folders.tsx:137 `depth={f.parent_id ? 1 : 0}`.

</details>

#### Project members (2 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `/projects/$projectId/members` | "Remove from project" is a danger action with no confirmation dialog and no undo. | code-only |
| minor | `/projects/$projectId/members` | Role terminology is inconsistent: the change-role menu offers Scientist/Default reviewer/Collaborator/Oversight, the table's Access column shows Owner/Editor/Viewer, and "How access works" describes Editor/Reviewer/Viewer. "Lead" (owner) can never be assigned, and "Default reviewer" silently maps to editor. | code-only |

<details><summary>Evidence</summary>

- `/projects/$projectId/members` — src/routes/projects/$projectId/members.tsx:256 `<DropdownMenuItem danger onClick={onRemove}>Remove from project</DropdownMenuItem>` (onRemove = remove.mutate directly).
- `/projects/$projectId/members` — src/routes/projects/$projectId/members.tsx:34-52 roles/accessFor/accessLabel; :127-146 RoleMenu; :196-215 "How access works" Editor/Reviewer/Viewer copy.

</details>

#### Project overview (2 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `/projects/$projectId` | Soft-deleted records leak into project screens: fetchRecordsForProject filters archived_at but not deleted_at, unlike the project-list builders which filter both. | code-only |
| minor | `/projects/$projectId` | Stale placeholder copy promises future work that already shipped: "authoring them from here lands with PROJ-02" and "Folders, members and settings are on their tabs", while the tabs and the milestones authoring UI exist. | code-only |

<details><summary>Evidence</summary>

- `/projects/$projectId` — src/lib/notebook-data.ts:344 `?project_id=eq.${projectId}&order=created_at.desc&archived_at=is.null&...` (no `deleted_at=is.null`); used by project overview (index.tsx:60) and folders (folders.tsx:55).
- `/projects/$projectId` — src/routes/projects/$projectId/index.tsx:222-224 `<Muted>Milestones ... authoring them from here lands with PROJ-02. Folders, members and settings are on their tabs.</Muted>`.

</details>

#### Samples (list) (2 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/routes/samples.tsx:278-291,355-380` | Phones cannot reach a sample's detail page. The desktop table is `max-md:hidden`; `MobileList` items pass only `onSelect` (no `link`), and the samples Inspector that opens on selection has no link to `/samples/$sampleId`. So Withdraw/Quarantine/Label and all tabs are unreachable on a phone. (Instruments mitigate this with an 'Open record' link; samples do not.) | code |
| minor | `src/routes/samples.tsx:66-68` | Tab/status vocabulary mismatch: the tab is "Awaiting" but the row status badge for the same samples reads "Reserved" (`STATUS.reserved.label`), and 'awaiting' is only applied when `status === 'reserved'`. | code |

<details><summary>Evidence</summary>

- `src/routes/samples.tsx:278-291,355-380` — `<Table ... className='max-md:hidden'>`; MobileList items `{ key, id, title, sub, status, onSelect, selected }` (no `link`); Inspector 'Sample summary' renders only DescriptionList items Type/Quantity/Location/Project.
- `src/routes/samples.tsx:66-68` — `awaiting: 'Awaiting'`; samples-data.ts `reserved: { tone:'progress', label:'Reserved' }`; `if (record.status === 'reserved') tabs.push('awaiting')`.

</details>

#### Settings · API and SDK (2 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/routes/settings/api.tsx:86-129` | Revoke and rotate for both personal tokens and service credentials have no `onError` and their errors are never rendered — a failed revoke/rotate silently leaves the token active while the user believes it was revoked. | needs live check |
| minor | `src/components/v3/settings/settings-api-tokens.tsx:236-241` | Revoke (immediate, permanent) and Rotate (invalidates the current secret) fire straight from the table row with no confirmation dialog. | code |

<details><summary>Evidence</summary>

- `src/routes/settings/api.tsx:86-129` — `const revokeToken = useMutation({ mutationFn: …, onSuccess: invalidate })` (no onError); only `createToken.isError` is rendered in the page body.
- `src/components/v3/settings/settings-api-tokens.tsx:236-241` — `onClick={() => onRevoke(row.id)}` / `onClick={() => onRotate(row.id)}`; identical shape in settings-service-credentials.tsx.

</details>

#### Shell / nav counts (2 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/lib/shell-counts.server.ts:33` | Sidebar Inbox badge counts `state <> 'following'`, which includes `done_today`, whereas the Inbox "Needs action" tab and Home's "Open inbox · N items" count only `needs_action`/`overdue`. The nav badge can therefore exceed the list it labels. | needs live check |
| minor | `src/lib/shell-counts.server.ts:60-63` | Sidebar Datasets badge and Home's "datasets with errors" chip use different authorities: the badge counts distinct datasets with an uncleared value flag, the chip counts datasets with `issue_count > 0` (which includes missing-unit-only issues). The two screens can report different numbers under the same label. | needs live check |

<details><summary>Evidence</summary>

- `src/lib/shell-counts.server.ts:33` — `select count(*)::int as n from api.my_work_items where state <> 'following'` (33) vs Home `state=in.(needs_action,overdue)` (home-data.ts:~232) and Inbox `itemTab` excluding seen/done_today (inbox.tsx:96-102). State vocabulary includes done_today (work-items/data.ts:75-80).
- `src/lib/shell-counts.server.ts:60-63` — badge: `count(distinct dataset_id) … from api.dataset_value_flags where cleared_at is null` (58-61); chip: `client.count('rpc/dataset_list_summary', '?issue_count=gt.0…')` (home-data.ts:~218).

</details>

#### Analysis studio › analyse mode (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/components/viz/analysis-panel.tsx:444, 1085-1091` | Deleting a saved analysis definition has no confirmation/undo (same pattern as views). | code-only |

<details><summary>Evidence</summary>

- `src/components/viz/analysis-panel.tsx:444, 1085-1091` — `onDelete={(id) => deleteMutation.mutate(id)}` → `<Button aria-label={`Delete ${saved.name}`} onClick={() => onDelete(saved.id)}>`.

</details>

#### Analysis studio › data preview (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/routes/analysis/new.tsx:1814-1823` | 'Open in data table' button and 'Download data preview' icon button in the collapsed Data preview have no onClick — clicking either does nothing. | code-only |

<details><summary>Evidence</summary>

- `src/routes/analysis/new.tsx:1814-1823` — `<Button variant="quiet" size="sm">Open in data table</Button>` and `<Button variant="quiet" size="icon" aria-label="Download data preview"><Icon name="download" size={16} /></Button>` — no handlers.

</details>

#### Analysis studio › flag handling (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/routes/analysis/new.tsx:261-268; src/components/viz/compare-view.…` | The studio preview/CSV and the Compare view materialise raw dataset rows and do not exclude flagged values, while notebook charts (materialiseLiveChart) and the Analyse panel do. Flagged values the UI says are 'left out of analyses and charts' are plotted in the studio and Compare and exported in CSV. | code-only |

<details><summary>Evidence</summary>

- `src/routes/analysis/new.tsx:261-268; src/components/viz/compare-view.…` — `materialiseAnalysisChart(spec, datasetQuery.data.source.columns, datasetQuery.data.rows)` (Studio) / `materialiseChart(draft, columns, rows)` (CompareView) vs `materialiseLiveChart` doing `filterRowsByFlags(dataset.rows, dataset.flags ?? [], usedFields)`.

</details>

#### Analysis studio › load view (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/routes/analysis/new.tsx:220-230, 326-332` | Loading a saved view whose dataset differs from the current selection is immediately discarded: loadView sets the spec, then setSelectedDatasetId triggers the dataset-change effect, which rebuilds a default spec and clears selectedViewId/viewName. The user's loaded view is wiped. | needs live check |

<details><summary>Evidence</summary>

- `src/routes/analysis/new.tsx:220-230, 326-332` — loadView `setSpec(view.spec) … setSelectedDatasetId(datasetId)`; effect `[selectedDataset, search.x, search.y]` → `setSpec(next); setSelectedViewId(null); setViewName('')`.

</details>

#### Analysis studio › saved views (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/routes/analysis/new.tsx:407, 1060-1095` | Deleting a saved analysis view is one click with no confirmation and no undo; the trash button calls the mutation directly. | code-only |

<details><summary>Evidence</summary>

- `src/routes/analysis/new.tsx:407, 1060-1095` — `onDelete={(id) => deleteMutation.mutate(id)}` → `SavedViewsPanel` `<Button aria-label={`Delete view ${view.name}`} onClick={() => onDelete(view.id)}>`; `deleteAnalysisView` issues a DELETE row.

</details>

#### Datasets › detail tabs (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/routes/datasets/$datasetId.tsx:176-179 + src/routes/datasets/$dat…` | The 'Overview' tab is unreachable: it links to the index route, whose only component immediately redirects to /snapshots, so clicking Overview highlights Overview for an instant and then lands on Snapshots with the Snapshots tab active. There is no Overview screen. | code-only |

<details><summary>Evidence</summary>

- `src/routes/datasets/$datasetId.tsx:176-179 + src/routes/datasets/$dat…` — Tab `{ key: 'overview', link: { to: '/datasets/$datasetId' } }`; index route returns `<Navigate to="/datasets/$datasetId/snapshots" replace />`.

</details>

#### Datasets › list (mobile) (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/routes/datasets.tsx:262-281, 305-350` | On phones the table is hidden and MobileList rows are given `onSelect` only (no `link`), while the Dataset inspector is a fixed/Sheet and its only navigation ('Open and fix') renders only when `issues > 0`. A dataset with no issues therefore cannot be opened at all on a phone. | needs live check |

<details><summary>Evidence</summary>

- `src/routes/datasets.tsx:262-281, 305-350` — MobileList item `onSelect: () => setSelected(d.uuid)` with no `link`; inspector CTA `{sel.issues > 0 ? <Button … Open and fix : null}`.

</details>

#### Help / copy (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/routes/help/index.tsx:187-188 vs 413-415` | The no-results help copy invites the user to "ask support; we answer within one working day", but the same page's Contact support section says requests "aren't set up yet" — the two statements contradict each other. | code |

<details><summary>Evidence</summary>

- `src/routes/help/index.tsx:187-188 vs 413-415` — "If you're stuck, ask support; we answer within one working day" (187-188); "Support requests from Sheetbase aren't set up yet" (414).

</details>

#### Help / release (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/routes/help/index.tsx:337-339` | The "· running here" badge is hard-coded onto `RELEASE_NOTES[0]` (version 3.4.0), independent of the actual deployed release that `ReleaseCard` renders from `help.release.version`. If the deployment is not 3.4.0 the page makes a false claim about what is running. | needs live check |

<details><summary>Evidence</summary>

- `src/routes/help/index.tsx:337-339` — `{i === 0 ? <span …>· running here</span> : null}` (337-339) inside a static `RELEASE_NOTES` array (36-…); real version via `useHelp()` in ReleaseCard (help.tsx:38-60).

</details>

#### Home / counts (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/routes/index.tsx:731-733` | Home's "Open inbox · N items" and the busy header use `counts.inbox` (`needs_action`/`overdue`), which is computed differently from the sidebar nav badge (`state <> 'following'`), so the two numbers shown for the same work can differ on one screen. | needs live check |

<details><summary>Evidence</summary>

- `src/routes/index.tsx:731-733` — `Open inbox · {counts?.inbox ?? '—'} items` (732); `counts.inbox` from home-data.ts `state=in.(needs_action,overdue)` vs shell-counts.server.ts:33 `state <> 'following'`.

</details>

#### Inbox / error state (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/routes/inbox.tsx:406-419 (query at work-items/data.ts:146-156)` | The work-items query has `retry: false` and no error branch; on failure `items` is empty and the screen renders "Nothing here / Nothing needs your action", presenting a load failure as an empty inbox. | needs live check |

<details><summary>Evidence</summary>

- `src/routes/inbox.tsx:406-419 (query at work-items/data.ts:146-156)` — `{query.isLoading ? 'Loading…' : 'Nothing here'}` (411) with `retry: false` (data.ts:154) and no `query.isError` handling anywhere in inbox.tsx.

</details>

#### Inbox / list (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/routes/inbox.tsx:399-401` | The toolbar states "Sorted by due date", but the list is fetched `order=created_at.desc` and only bucketed into Today / Next 7 days / Later; within a bucket rows are in created-at order, not due-date order. The copy misdescribes the order. | code |

<details><summary>Evidence</summary>

- `src/routes/inbox.tsx:399-401` — copy at 400; fetch order at src/lib/work-items/data.ts:143 (`order=created_at.desc`), grouping in `groupWorkItems` does not sort by due.

</details>

#### Inbox / mark seen (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/routes/inbox.tsx:290-293` | "Mark all seen" invalidates only `['ui-port','inbox']`; the sidebar Inbox badge and Home counts come from router context (`beforeLoad`), which is not invalidated or refetched, so the badge stays stale until a full navigation. | needs live check |

<details><summary>Evidence</summary>

- `src/routes/inbox.tsx:290-293` — `invalidateQueries({ queryKey: ['ui-port','inbox'] })` (293); shell counts loaded in __root.tsx beforeLoad (70-77) and never refetched here.

</details>

#### New experiment (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `/experiments/new` | Choosing a protocol version silently starts the experiment even when "Start the experiment now" is unchecked, because the start branch tests `startNow \|\| protocolVersionId`. | code-only |

<details><summary>Evidence</summary>

- `/experiments/new` — src/routes/experiments/new.tsx:140 `if (startNow \|\| protocolVersionId) { ... start_experiment ... }`; checkbox at ~:270 controls only `startNow`.

</details>

#### Pipelines · Run alias (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/routes/pipelines/runs/$runId.tsx:14-24` | The legacy `/pipelines/runs/$runId` redirect renders `null` when the run cannot be resolved (unknown id, deleted run, or query error), leaving a completely blank page with no message and no way back. | code |

<details><summary>Evidence</summary>

- `src/routes/pipelines/runs/$runId.tsx:14-24` — `if (pipelineId.data) { ... } return null` — no loading, not-found, or error branch.

</details>

#### Project settings (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `/projects/$projectId/settings` | A failed save whose error is not a DataClientError (e.g. an optimistic-concurrency/stale-revision conflict) surfaces nothing at all — saveError stays null and there is no onError toast, so the write silently fails. | code-only |

<details><summary>Evidence</summary>

- `/projects/$projectId/settings` — src/routes/projects/$projectId/settings.tsx:174-176 `const saveError = save.error instanceof DataClientError ? save.error.message : null`; the save useMutation (~:84-104) has no onError.

</details>

#### Registries (shared) (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/components/v3/inventory/list.tsx:83-212` | Sort / Filter / Fields / Group controls are non-functional on Samples, Materials and Protocols. `ListToolbar` passes `views` through to `ViewControls`, but the routes never pass `onSort`, and the Filter/Fields menu items have no handlers — selecting 'Sort: …' only relabels the trigger and never re-queries. | needs live check |

<details><summary>Evidence</summary>

- `src/components/v3/inventory/list.tsx:83-212` — `const pick = (s) => { setLocalSort(s); onSort?.(s) }` with no `onSort` from routes (samples.tsx:172-176, materials.tsx, protocols.tsx pass `views` only); `<DropdownMenuItem key={f} className='pl-[30px]'>{f}…</DropdownMenuItem>` and `FieldsButton` items `icon='check'` with no onClick.

</details>

#### Review · signing/inspector (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/routes/review/$revisionId.tsx:1671,2549,1058` | Several review surfaces print raw user UUIDs to people: assigned reviewers (“{userId}”, with initials derived from the UUID), the witness picker options (“{member.user_id} · role”), and the returned banner (“by {returnedByUserId}”). Assistants elsewhere in the app resolve names. | code |

<details><summary>Evidence</summary>

- `src/routes/review/$revisionId.tsx:1671,2549,1058` — <span className="font-mono">{userId}</span>; <option>{member.user_id} · {member.workspace_role}</option>; `by ${returnedByUserId}`.

</details>

#### Schedule / grid bounds (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/routes/schedule.tsx:46-49` | The grid maps time to percent across a fixed 08:00–18:00 window with no clamp; a booking starting/ending outside that window yields a negative left or width >100% and is clipped/invisible, yet the booking dialog permits any `type=time`. | needs live check |

<details><summary>Evidence</summary>

- `src/routes/schedule.tsx:46-49` — `DAY_START = 8*60`, `DAY_END = 18*60`, `pct = ((toMin(t) - DAY_START) / (DAY_END - DAY_START)) * 100` (46-49); used unclamped for `left`/`width` (316-325).

</details>

#### Schedule / phone variant (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/routes/schedule.tsx:141-162, 298` | Every navigation control (prev / Today / next / Day-Week toggle) is `max-md:hidden`, and `PhoneDay` is always fed the UTC `today`, so on a phone there is no way to view any other day or week — the phone Schedule is frozen to today. | needs live check |

<details><summary>Evidence</summary>

- `src/routes/schedule.tsx:141-162, 298` — prev/Today/next/toggle all `max-md:hidden` (142,148,153,162); `PhoneDay day={view === 'day' ? anchor : today}` (197) and `view` cannot be changed on phones.

</details>

#### Schedule / timezone (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/routes/schedule.tsx:88` | "Today" is computed as `iso(new Date())` (UTC calendar day), while bookings are formatted in the booking's own timezone (`dayFmt(tz)` in schedule-data.ts). For a non-UTC booking/workspace the highlighted day, the Day view and "Materials for today" can be a day off; Home renders the same bookings in the workspace timezone. | needs live check |

<details><summary>Evidence</summary>

- `src/routes/schedule.tsx:88` — `const today = useMemo(() => iso(new Date()), [])` (88) with `iso = (d) => d.toISOString().slice(0,10)` (23) vs `date: dayFmt(tz).format(...)` (schedule-data.ts:56-57).

</details>

#### Viz › ChartFrame (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| major | `src/components/viz/chart-frame.tsx:112-150` | Every chart (analysis preview, analysis view, notebook chart block) renders a 'Download chart' icon button with no onClick, plus a 'Chart actions' menu whose three items are all `disabled`. Four visible controls that do nothing. | code-only |

<details><summary>Evidence</summary>

- `src/components/viz/chart-frame.tsx:112-150` — `<Button variant="quiet" size="icon" aria-label="Download chart" disabled={loading}>` has no onClick; menu items `disabled>Open in analysis`, `disabled>Copy snapshot link`, `disabled>Export data`.

</details>

#### Pipelines · Agents (4 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `src/components/v3/pipelines/agents/agent-surface.tsx:39-46,150-160` | Pending proposals are grouped into “Waiting on others” purely from the viewer's capability flag, so a proposal nobody in the workspace can approve is labelled as if a colleague is handling it. | needs live check |
| minor | `src/components/v3/pipelines/agents/agent-surface.tsx:736-738,801` | When the workspace has no service credentials, the policy form shows a “No credentials” option and the Create policy button is disabled, but nothing explains why the action is unavailable. | code |
| minor | `src/components/v3/pipelines/agents/agent-surface.tsx:860-868` | Disabling an execution policy (removing a delegation) happens immediately from the table with no confirmation dialog. | code |
| minor | `src/routes/pipelines/agents.tsx:236-252` | The UI's own approval matrix maps operation_kind → capability (record.create / pipelines.manage / schema.edit) independently of the server's decide RPC; if the two drift the UI will show or hide the decision controls wrongly. | needs live check |

<details><summary>Evidence</summary>

- `src/components/v3/pipelines/agents/agent-surface.tsx:39-46,150-160` — `if (p.status === 'pending') (canApprove ? needsYou : waiting).push(p)` — `waiting` means “waiting on others”, including when there are no others.
- `src/components/v3/pipelines/agents/agent-surface.tsx:736-738,801` — `<option value="">No credentials</option>` plus `disabled={!valid}` where `valid` requires `credentialId.length > 0`; no hint text.
- `src/components/v3/pipelines/agents/agent-surface.tsx:860-868` — `<Button variant="danger" size="sm" onClick={() => onDisable(p)}>Disable</Button>` in AgentPoliciesPanel.
- `src/routes/pipelines/agents.tsx:236-252` — `canApprove` ternary on `selectedProposal.operation_kind` with `hasCapability(...)`; no shared source with the RPC policy.

</details>

#### Import › map step (3 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `src/components/import/import-flow.tsx:594-597, 915-923` | While the dataset list loads, `showMapping` is false even for a parsed file, so the 'Choose how to read this file' banner appears with the copy 'This file does not match a registered parser.' — a misleading claim when a parser did match and the dataset query is simply pending (the 'not available' banner can show simultaneously). | needs live check |
| minor | `src/components/import/import-flow.tsx:631-647` | Continue to review awaits saveParserMapping (a convenience default) before navigating; if that save is refused (e.g. permission/parser rules) the whole step fails with 'Could not review the file.' even though review needs no save. | code-only |
| nit | `src/components/import/import-flow.tsx:1022-1023` | The map table says the mapping is 'saved as the default for {parser}' while it is only saved on Continue; before that it reads as already saved. | code-only |

<details><summary>Evidence</summary>

- `src/components/import/import-flow.tsx:594-597, 915-923` — `showMapping = parsed && Boolean(dataset) && Boolean(activeParser \|\| manual)`; fallback banner `{file.data.recognitionMessage ?? 'This file does not match a registered parser.'}`.
- `src/components/import/import-flow.tsx:631-647` — `await saveParserMapping(client, { parserId, targetKey, mapping })` then `writeSearch({...search, step:'check'})`, both inside the try whose catch sets the error banner.
- `src/components/import/import-flow.tsx:1022-1023` — `{parser ? ` · saved as the default for ${parser.label}` : ''}` rendered on every keystroke/select change.

</details>

#### Client portal (2 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `src/routes/client-portal.tsx:432-436` | The portal tab is React state, not a URL param, so portal sections are not linkable and browser Back does not return to the previous tab; also `latestTeamMessage` assumes ascending order via `[...messages].reverse()` without an explicit sort. | needs live check |
| minor | `src/routes/client-portal.tsx:498-508` | The CDMO aside's “Reply” button is rendered for every viewer, including non-client accounts where the Messages composer is replaced by a “Messaging is for client portal accounts” note — the button promises an action the user cannot perform. | needs live check |

<details><summary>Evidence</summary>

- `src/routes/client-portal.tsx:432-436` — `const [tab, setTab] = useState<PortalTab>('projects')`; `[...(messages.data ?? [])].reverse().find(m => m.authorKind === 'team')`.
- `src/routes/client-portal.tsx:498-508` — `<Button size="sm" className="mt-2" onClick={() => setTab('messages')}>Reply</Button>` outside the `isClient ?` gate used inside PortalMessages.

</details>

#### Experiment detail frame (2 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `/experiments/$expId` | Tab counts for Samples/Datasets/Files are derived only from outgoing record_links (source = experiment) and `target_kind`; anything linked with the experiment as target is not counted, so a tab can say 0 while the record is linked. | needs live check |
| nit | `/experiments/$expId` | Route doc comment is stale: it says "Results/Files state their unbuilt capabilities", but both tabs are fully implemented. | code-only |

<details><summary>Evidence</summary>

- `/experiments/$expId` — src/routes/experiments/$expId.tsx:103-105 `countKind` filters `links.data` from useExperimentLinks (source_record_id=eq.recordId) at :77-80.
- `/experiments/$expId` — src/routes/experiments/$expId.tsx:16-17 comment; results.tsx and files.tsx implement real content.

</details>

#### Review · signing (2 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `src/routes/review/$revisionId.tsx:2494-2510` | When signing is unavailable and the reason is neither an unmet certification nor “already signed” nor “not an assigned reviewer”, the panel renders nothing (e.g. certifications query failed) — the person gets no statement of why Sign revision is absent. | needs live check |
| minor | `src/routes/review/$revisionId.tsx:2530-2545` | The witness picker is disabled when the member query errors or is fetching, with no explanation of why it is unusable; the user sees a greyed select. | needs live check |

<details><summary>Evidence</summary>

- `src/routes/review/$revisionId.tsx:2494-2510` — Ternary chain ends in `: null`; certified-required branch only fires when `certifications.isSuccess`.
- `src/routes/review/$revisionId.tsx:2530-2545` — `disabled={requestingWitness \|\| members.isFetching \|\| members.isError}` and no accompanying message.

</details>

#### Settings · Audit log (2 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `src/routes/settings/audit.tsx:50,206-212` | The operation filter list is built from the 200 loaded rows only (`LIMIT = 200`), so operations with no recent occurrence are unfilterable and there is a loading gap with no state (the table is empty and the empty-state only renders after load). | code |
| nit | `src/routes/settings/audit.tsx:88-105` | “Export CSV” writes only the filtered/visible rows while sitting under a header that implies the whole log; the disclaimer is in small print at the bottom of the page. | code |

<details><summary>Evidence</summary>

- `src/routes/settings/audit.tsx:50,206-212` — `const operations = useMemo(() => [...new Set(rows.map(r => r.operation))].sort())` over `fetchWorkspaceActivity(..., LIMIT)`; empty state gated on `!activity.isLoading`.
- `src/routes/settings/audit.tsx:88-105` — `const lines = visible.map(...)` with `a.download = 'audit-log.csv'`.

</details>

#### Settings · General (2 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `src/components/v3/settings/settings-general.tsx:131-140` | Time zone is a free-text input with no validation or IANA list, so an invalid zone can be saved (the RPC is the only guard) and Save is enabled regardless of whether anything changed. | code |
| nit | `src/components/v3/settings/settings-general.tsx:222` | The record-ID example is hard-coded to a past year — `{prefix}-2025-0001` — while the page is otherwise data-driven; in 2026 the example demonstrates stale numbering. | code |

<details><summary>Evidence</summary>

- `src/components/v3/settings/settings-general.tsx:131-140` — <Input aria-label="Time zone" value={form.timezone} onChange={…} />; Save button only disabled on `save.isPending \|\| query.isLoading \|\| query.isError`.
- `src/components/v3/settings/settings-general.tsx:222` — `{prefix ? `${prefix}-2025-0001` : '—'}`.

</details>

#### Analysis home (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| nit | `src/routes/analysis/index.tsx:349` | The detail aside says 'Cited analyses are frozen: editing makes a new version', but the studio's Save with a selected view updates that same view in place (version bump), contradicting the claim. | code-only |

<details><summary>Evidence</summary>

- `src/routes/analysis/index.tsx:349` — Aside `<Muted>Cited analyses are frozen: editing makes a new version.</Muted>` vs `saveAnalysisView({ id: selectedViewId … })` → `updateAnalysisView`.

</details>

#### Datasets › Imports tab (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `src/components/v3/datasets/dataset-imports-tab.tsx:134-135` | Import receipts are inert: rows carry the receipt id but no link to /import/$importId (or any drill-down), so a failed import shown here cannot be opened or retried from the tab. | code-only |

<details><summary>Evidence</summary>

- `src/components/v3/datasets/dataset-imports-tab.tsx:134-135` — `{rows.map((row) => (<TableRow key={row.id}>` with no `<Link>`; the receipt `id` is the only identity rendered nowhere clickable.

</details>

#### Datasets › Snapshots create (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `src/routes/datasets/$datasetId/snapshots.tsx:93-100` | When the dataset-revision read fails, `canSnapshot` is false and the disabled tooltip says 'Archived datasets cannot be snapshotted.' — an error is misreported as an archive state. | code-only |

<details><summary>Evidence</summary>

- `src/routes/datasets/$datasetId/snapshots.tsx:93-100` — `snapshotDisabledReason = !canWrite ? … : datasetQuery.isLoading ? … : datasetQuery.data?.lifecycle !== 'active' ? 'Archived datasets cannot be snapshotted.' : null` (data undefined on error).

</details>

#### Datasets › detail (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `src/routes/datasets/$datasetId.tsx:80-90` | The detail layout resolves the dataset from `useDatasetSummaries()`, which filters `lifecycle=eq.active`. Opening an archived dataset's URL (or one not in the summary page) renders 'Dataset not found' rather than an archived state. | code-only |

<details><summary>Evidence</summary>

- `src/routes/datasets/$datasetId.tsx:80-90` — `const dataset = summaries.data?.find((d) => d.uuid === datasetId)`; summaries come from `dataset_list_summary`/fetch path that excludes archived rows.

</details>

#### Datasets › list toolbar (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `src/components/v3/inventory/list.tsx:186-196 (used by src/routes/data…` | The toolbar 'Filter' dropdown lists Status/Owner/Updated items with no onClick (and no filter UI behind them) — clicking does nothing. | code-only |

<details><summary>Evidence</summary>

- `src/components/v3/inventory/list.tsx:186-196 (used by src/routes/data…` — `{(filters?.length ? filters : ['Status','Owner','Updated']).map((f) => <DropdownMenuItem key={f} className="pl-[30px]">{f}…</DropdownMenuItem>)}` with no handler.

</details>

#### Evidence (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `src/routes/evidence/$revisionId.tsx:205-214` | “Export evidence package” is a bare `<a href="/api/export/revision/{id}/package">` with no error handling — a 404/500 navigates the tab to a raw error body rather than telling the user the export failed. | code |

<details><summary>Evidence</summary>

- `src/routes/evidence/$revisionId.tsx:205-214` — `<Button variant="primary" nativeButton={false} render={<a href={…} />} />`.

</details>

#### Help / shortcuts (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `src/routes/help/shortcuts.tsx:53-70` | The help page and `?` dialog list every scoped shortcut (List/Notebook/Review) from the registry even though most have no handler on the current route, so a user can be shown shortcuts that do nothing where they are standing. (A comment acknowledges this, but the copy does not.) | needs live check |

<details><summary>Evidence</summary>

- `src/routes/help/shortcuts.tsx:53-70` — `definitions={registry.definitions.filter(d => !d.additional)}` (53-59); SCOPED_SHORTCUTS merged into the registry unconditionally (shortcut-provider.tsx:66-79) while handlers attach only on mounted routes.

</details>

#### Import › file size formatting (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `src/components/import/import-flow.tsx:201-204 vs src/lib/file-attach.…` | Two 'formatBytes' helpers disagree on units: import shows KB/MB, attachment code shows KiB/MiB for the same byte counts. | code-only |

<details><summary>Evidence</summary>

- `src/components/import/import-flow.tsx:201-204 vs src/lib/file-attach.…` — import: `${bytes/(1024*1024)} MB` / `${round(bytes/1024)} KB`; file-attach: `.toFixed(1)} MiB` / `KiB`.

</details>

#### Import › review step (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `src/components/import/import-flow.tsx:1072-1084, 1105-1112` | The review error banner instructs 'Fix these rows before importing' but the flow offers no way to edit rows (no cell editing, no jump to the file); the only path is to abandon and fix the source file externally. Also the commit button counts only 'added' rows while the summary says 'Committing {added}' although flagged rows are committed too. | code-only |

<details><summary>Evidence</summary>

- `src/components/import/import-flow.tsx:1072-1084, 1105-1112` — `<Banner tone="bad" title="Fix these rows before importing">` with a read-only ReviewTable; button `Import {review.data?.summary.added ?? 0} rows`, footer `Committing {review.summary.added} rows`.

</details>

#### Import › upload step (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `src/components/import/import-flow.tsx:281-300, 483-485` | The copy promises 'Nothing is written until you import', but for a New dataset the upload step already calls resolveImportTarget → createDataset before parsing. Abandoning the upload leaves an empty Dataset behind. | code-only |

<details><summary>Evidence</summary>

- `src/components/import/import-flow.tsx:281-300, 483-485` — `const target = await resolveImportTarget(client, { mode: 'new', … })` inside `start(file)` runs after file selection, before parse/commit; copy at line 484 says nothing is written until import.

</details>

#### Inbox / filters (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `src/routes/inbox.tsx:38` | The type filter row includes "Following", but a following item always lands in the Following tab (`itemTab`), so selecting that filter in Needs action / Done today can only ever yield nothing — a filter that can't match. | code |

<details><summary>Evidence</summary>

- `src/routes/inbox.tsx:38` — types includes `['following', 'Following', 'stored', 'following']` (38); `itemTab` returns 'following' before any type test (97-99).

</details>

#### Instruments (detail) (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `src/routes/instruments/$instrumentId.tsx:183-207` | 'Record calibration' is offered to every role; there is no capability/role gate in the UI (the RPC may refuse), unlike the registry inspector which gates retire/method changes behind `canManage`. | needs live check |

<details><summary>Evidence</summary>

- `src/routes/instruments/$instrumentId.tsx:183-207` — PageHeader `actions` renders the 'Record calibration' Button unconditionally.

</details>

#### Instruments (list) (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `src/components/v3/instruments/instruments-data.ts:600-614` | The registry 'Calibration due' column uses the calibration with the greatest `due_at` per instrument (ordered `due_at.desc`), not the most recently performed one. A recalibration with a nearer due date can be masked by an older row carrying a later due date, hiding an overdue instrument. | needs live check |

<details><summary>Evidence</summary>

- `src/components/v3/instruments/instruments-data.ts:600-614` — `?select=...&order=due_at.desc,id.desc&limit=500` then `if (!latest.has(row.instrumentId)) latest.set(...)`.

</details>

#### Materials/Instruments (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `src/routes/instruments.tsx:378-402` | Instruments mobile rows expose intake method + location but no 'Book' action; bookability (retired/qualified) is only discoverable by opening the inspector or Schedule, so a phone user must open a record to find out an instrument cannot be booked. | needs live check |

<details><summary>Evidence</summary>

- `src/routes/instruments.tsx:378-402` — MobileList item `sub: ${intakeMethodLabel(i.intakeMethod)} · ${i.location ?? 'No location'}` and status only shows calibration/health; the inspector's 'Book' link lives in the desktop-and-mobile inspector.

</details>

#### Project datasets tab (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `/projects/$projectId/datasets` | Header/tab count is read with `client.count('datasets', ...primary_project_id...archived_at...)` while the rows come from `dataset_list_summary`; if the two boundaries disagree (RLS, archived handling) the count and the list diverge. | needs live check |

<details><summary>Evidence</summary>

- `/projects/$projectId/datasets` — src/components/v3/projects/project-lists.ts:216-234 fetchProjectDatasetsPage counts `datasets` but lists via the RPC; the same mismatch is surfaced in $projectId.tsx:53 useProjectDatasetCount.

</details>

#### Project detail header (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `/projects/$projectId` | A "Members" action button sits in the header and a "Members" tab exists — two affordances for one destination. | needs live check |

<details><summary>Evidence</summary>

- `/projects/$projectId` — src/routes/projects/$projectId.tsx:109 header `<Button ...>Members</Button>` and :162 `label: 'Members'` tab.

</details>

#### Project tabs (all) (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `/projects/$projectId/*` | When the project can't be resolved, the layout header says "Project not found" but each tab body returns null (overview/settings/members/folders) or the out-of-scope list, leaving a header over a blank page. | code-only |

<details><summary>Evidence</summary>

- `/projects/$projectId/*` — src/routes/projects/$projectId/index.tsx:96 `if (!project) return null`; settings.tsx:169-176; members.tsx:96; folders.tsx:117.

</details>

#### Readings (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `src/routes/readings/new.tsx:232-234` | The 'No planned rows to fill' warning is gated only on `datasets.isLoading`, not on `plannedRows`, so while the planned-rows query is still in flight `datasetsWithPlans` is empty and the blocking warning flashes before data arrives. | needs live check |

<details><summary>Evidence</summary>

- `src/routes/readings/new.tsx:232-234` — `const noPlans = !datasets.isLoading && datasetsWithPlans.length === 0` where `datasetsWithPlans` depends on `allPlannedRows = plannedRows.data ?? []`.

</details>

#### Records (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `/records/$recordId/notebook` | Renaming the notebook title has no `onError`: a refused save leaves the typed title visible in the input (only reset when `record.title` later changes), so a failed rename looks applied. | needs live check |

<details><summary>Evidence</summary>

- `/records/$recordId/notebook` — src/routes/records/$recordId/notebook.tsx:998-1010 `saveTitle` defines only `onSuccess`; the blur handler (:1140-1156) mutates and returns without rollback.

</details>

#### Review · decisions (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `src/routes/review/$revisionId.tsx:2014-2020` | Confirming a review decision closes the dialog before the async confirm resolves (ConfirmDialogAction wraps DialogClose), so a failure surfaces only as a paragraph below the buttons and can be missed; the action button is also not disabled while `pendingKind` is being submitted, allowing double submission. | needs live check |

<details><summary>Evidence</summary>

- `src/routes/review/$revisionId.tsx:2014-2020` — `<DialogClose render={<Button … onClick={onConfirm} …/>}>` with no `disabled` tied to a pending flag, while `confirm()` awaits `onAfterDecision`.

</details>

#### Review · header (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| nit | `src/routes/review/$revisionId.tsx:946-958` | WorkspaceHeader renders StatusBadge twice in an `{state ? …} : {!state ? …}` pair with identical bodies — dead duplication that suggests one branch was meant to differ. | code |

<details><summary>Evidence</summary>

- `src/routes/review/$revisionId.tsx:946-958` — Both branches: `<StatusBadge status={lifecycle.status} vocabulary={lifecycleVocabulary} size="sm" />`.

</details>

#### Samples (withdraw) (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `src/components/v3/samples/withdraw-dialog.tsx:315-318` | When the sample has no stored unit, the unit select defaults to 'mL' and the free/available figures are shown with the balance's unit, so the form can submit a unit that doesn't match the balance; the mismatch is only caught server-side (surfaced via SB006 text parsing). | needs live check |

<details><summary>Evidence</summary>

- `src/components/v3/samples/withdraw-dialog.tsx:315-318` — `const [unit, setUnit] = useState(sample.quantityUnit ?? 'mL')` vs `free = balances?.free ?? sample.quantity ?? 0` and `unitLabel = balances?.unit ?? sample.quantityUnit ?? null`.

</details>

#### Schedule / empty state (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `src/routes/schedule.tsx:248-252, 358-362` | With no instruments the day/week grids render an empty frame (only the 08:00-18:00 header); there is no "no instruments configured" empty state, and the Book dialog's picker offers only "Choose…". | needs live check |

<details><summary>Evidence</summary>

- `src/routes/schedule.tsx:248-252, 358-362` — `instruments.map(...)` over an empty array leaves `<div className="grid grid-cols-[180px_1fr]">` with just the header row (252-256).

</details>

#### Schedule / weekend copy (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `src/routes/schedule.tsx:213-216, 337-343` | Both the empty state and the weekend overlay promise "Weekend access needs a supervisor-approved booking", but the booking dialog creates `status: 'tentative'` with no weekend/approval check or approval affordance, so the stated gate is nowhere implemented. | needs live check |

<details><summary>Evidence</summary>

- `src/routes/schedule.tsx:213-216, 337-343` — copy at 214-215 and 342-343; `bookInstrument` uses `status: 'tentative'` (schedule-data.ts:150).

</details>

#### Settings · Electronic signatures (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `src/routes/settings/signatures.tsx:146-190` | Withdraw certification — which revokes signing eligibility — has no confirmation, and the `verify` and `practice` mutations have no `onError`, so a failed request ID or practice signature gives no feedback. | code |

<details><summary>Evidence</summary>

- `src/routes/settings/signatures.tsx:146-190` — `onClick={() => withdraw.mutate()}`; `verify`/`practice` mutations define only `mutationFn` (+ onSuccess for practice).

</details>

#### Settings · Integrations (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `src/routes/settings/integrations/$connectorId.tsx:55-60` | Pause/Activate connector has no `onError`; a refused status change gives no feedback (the button just stops spinning) and the status silently stays as it was. | needs live check |

<details><summary>Evidence</summary>

- `src/routes/settings/integrations/$connectorId.tsx:55-60` — `const statusMutation = useMutation({ mutationFn: …, onSuccess: () => queryClient.invalidateQueries(...) })` — no onError, no error render.

</details>

#### Settings · Members (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `src/routes/settings/members.tsx:372-401` | Suspend/Reinstate execute directly from the row dropdown with no confirmation (Remove and group-delete do confirm); revocation of a pending invitation also fires immediately. | code |

<details><summary>Evidence</summary>

- `src/routes/settings/members.tsx:372-401` — `<DropdownMenuItem onClick={() => act.mutate({ kind: 'suspend', userId: m.userId })}>`; invitation `onClick={() => revoke.mutate(i.id)}`.

</details>

#### Settings · Notifications (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `src/components/v3/settings/settings-notifications.tsx:139-176` | Quiet-hours start/end and digest time accept any combination with no validation and no stated time zone, so an end before the start is silently savable; Save is enabled even when nothing changed. | code |

<details><summary>Evidence</summary>

- `src/components/v3/settings/settings-notifications.tsx:139-176` — Free `<Input type="time">` fields bound straight to state; no comparison or zone label; Save disabled only for `save.isPending \|\| preferencesQuery.isLoading`.

</details>

#### Settings · Profile (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `src/routes/settings/profile.tsx:51-52` | Appearance preference is applied locally first and the server write failure is swallowed (`.catch(() => undefined)`), so the UI shows the theme as saved even when it was not persisted. | code |

<details><summary>Evidence</summary>

- `src/routes/settings/profile.tsx:51-52` — `theme.setPref(value); void setUserAppearance(appearanceClient, value).catch(() => undefined)`.

</details>

#### Settings · Project access (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `src/routes/settings/access.tsx:184-196` | When the user manages no projects the “Add rule” button is silently absent (no explanation), unlike the explicit denied copy used on other admin surfaces. | code |

<details><summary>Evidence</summary>

- `src/routes/settings/access.tsx:184-196` — `actions={manageableProjects.length ? <Button …>Add rule</Button> : null}`.

</details>

#### Shell / bottom tabs (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| nit | `src/components/v3/shell/app-shell.tsx:337-347` | The same `/` destination is labelled "Today" in the phone bottom bar and "Home" in the sidebar/rail and page header, and "Today" is also used for the inspector section — three labels for one concept. | code |

<details><summary>Evidence</summary>

- `src/components/v3/shell/app-shell.tsx:337-347` — bottom tab `<Icon name="calendar"/>Today` (345-347) vs nav label `Home` (nav.ts:30).

</details>

#### Shell / nav visibility (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `src/lib/nav-visibility.ts:40-47 + nav.ts:3-12` | `filterNavForRole` and the `roles`/`capability` fields are plumbed through but no nav item ever declares either, so the role filter is currently a no-op and the 'sections a role cannot open are omitted' behaviour is untested in product paths. | code |

<details><summary>Evidence</summary>

- `src/lib/nav-visibility.ts:40-47 + nav.ts:3-12` — `canSeeNavItem` returns true unless `roles`/`capability` set (40-47); primaryNav/recordNav declare neither (nav.ts:29-50).

</details>

#### Shell / notification popover (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `src/components/v3/shell/app-shell.tsx:636-658` | The v3 bell popover has no max-height/overflow (12 items) and every row is a navigation link that neither dismisses the popover nor marks the row read — unlike the legacy bell which scrolls and marks read. | needs live check |

<details><summary>Evidence</summary>

- `src/components/v3/shell/app-shell.tsx:636-658` — `<PopoverContent className="w-[380px]">` with no `max-h`/`overflow-y` (637 area); compare legacy `max-h-80 … overflow-y-auto` and `markRead.mutate()` (notifications-bell.tsx:76-99).

</details>

#### Shell / sidebar (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| nit | `src/components/v3/shell/app-shell.tsx:874-875` | The "Pinned projects" section header is always rendered even when `pinned` is empty, leaving a dangling heading. | needs live check |

<details><summary>Evidence</summary>

- `src/components/v3/shell/app-shell.tsx:874-875` — Unconditional `<div>Pinned projects</div>` (874-875) precedes `pinned.map(...)` (877).

</details>

#### Shell / theme+collapse (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `src/components/v3/shell/app-shell.tsx:108-127` | Sidebar collapse applies `localStorage` first, then overwrites it with the server preference when that fetch resolves — a user's local collapse can flip after load; no reconciliation. | needs live check |

<details><summary>Evidence</summary>

- `src/components/v3/shell/app-shell.tsx:108-127` — `setCollapsed(saved)` (119) then `.then((preferences) => { if (!cancelled && preferences) setCollapsed(preferences.navCollapsed) })` (124-126).

</details>

#### UI primitives · ConfirmDialog (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| nit | `src/components/v3/ui/confirm-dialog.tsx:29-36` | `ConfirmDialogTrigger` declares an `asChild` prop that it ignores (it renders via base-ui `render={children}`), so call sites like ActionButtons pass a prop with no effect — a misuse trap for future callers. | code |

<details><summary>Evidence</summary>

- `src/components/v3/ui/confirm-dialog.tsx:29-36` — `export function ConfirmDialogTrigger({ children }: { children: React.ReactElement; asChild?: boolean }) { return <DialogPrimitive.Trigger render={children} /> }`.

</details>

#### UI primitives · Secret (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `src/components/v3/ui/secret.tsx:19-22` | A copy that fails (insecure context, permission denied) still shows the “Copied” toast, so the user may paste nothing from a clipboard they think holds the token. | code |

<details><summary>Evidence</summary>

- `src/components/v3/ui/secret.tsx:19-22` — `void navigator.clipboard.writeText(value); toast(copiedMessage)` — promise result ignored.

</details>

#### UI primitives · Table (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| nit | `src/components/v3/ui/table.tsx:4-9` | The Table primitive provides no empty/loading affordance or caption slot, and call sites frequently render a bare header-only table mid-load (e.g. settings/audit.tsx, settings/members.tsx) — the shell invites an empty table with no state. | code |

<details><summary>Evidence</summary>

- `src/components/v3/ui/table.tsx:4-9` — `<table data-slot="table" className={cn('num w-full border-collapse text-body', className)}>` — no children handling; audit.tsx:206 only adds an EmptyState after `!isLoading`.

</details>

#### Viz › CompareView chart (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| minor | `src/components/viz/compare-view.tsx:447-456; src/components/viz/chart…` | The Compare preview renders ChartRenderer without onSelectionChange, so its hit targets are `cursor-pointer`/clickable but resolve to the default `() => {}` — clicking or arrow-keying a point gives no feedback, unlike the studio preview. | code-only |

<details><summary>Evidence</summary>

- `src/components/viz/compare-view.tsx:447-456; src/components/viz/chart…` — `<ChartRenderer title="Compare preview" … />` with no `selection`/`onSelectionChange`; renderer uses `onSelect: onSelectionChange ?? (() => {})`.

</details>

#### Viz › chart configurator (1 findings)

| Sev | Where | Defect | Status |
|---|---|---|---|
| nit | `src/components/viz/chart-configurator.tsx:601-627` | The 'Interval' select offers 'Explicit field', but choosing it returns immediately without changing state (the select then snaps back); it is a no-op option. | code-only |

<details><summary>Evidence</summary>

- `src/components/viz/chart-configurator.tsx:601-627` — `if (value === 'field') return` inside onChange; the value binding derives from `errorBars?.source === 'computed' … : errorBars?.fieldId ? 'field' : ''`.

</details>

## 4. Triage order

1. **Both blockers.** The replacement-lot query is a wrong request shape with a two-step fix;
   the sheet read-only bug is one prop (`readOnly={!projectIdParam}`) and restores editing to
   every canonical sheet link at once. Neither needs design work.
2. **Silent failures (theme 3).** Highest ratio of user harm to effort: add `onError` plus a
   rendered message where a write can fail. Start with revoke/rotate, then connector status,
   then signatures and appearance.
3. **Dead ends (theme 6).** A blank page or a vanished panel is where a user gives up. Fix the
   run-alias `null`, the search/inbox error branches, and the signing panel’s missing reason.
4. **Copy that lies (themes 1 and 4).** Either build the missing control or change the copy —
   but do not leave the two contradicting each other. Trigger creation, pipeline creation and
   the pipeline first-version dead end need a decision, not a patch.
5. **Confirmation dialogs (theme 2).** Reuse the existing `ConfirmDialog` pattern already used
   for member removal and group deletion.
6. **Raw identifiers (theme 5), empty states (theme 7), phone gaps (theme 8), nits.** Batch by
   component.

## 5. Reproducing this report

```bash
pnpm services:up
pnpm db:fresh                 # reset + migrate + seed (local dev only)
pnpm dev                      # http://localhost:3000
# then drive the routes listed in §3 at 1440×900 and 390×844
```

The two blocker checks are single requests and need no browser:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  "http://localhost:3000/api/db/record_links?source_record_id=in.(select%20id%20from%20api.records%20where%20identifier=eq.MAT-0001)&link_type=eq.material&limit=25"
# 400 — see §2.1
```

---

_Findings are reported as the reviewers and the live sweep observed them; each row names its
own verification state so a fixer knows whether the claim still needs a rendered check._
