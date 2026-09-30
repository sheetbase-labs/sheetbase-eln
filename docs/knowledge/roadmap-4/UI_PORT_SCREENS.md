# UI port — screens still to design, port or retire

**Status (2026-09-30):** hand-off for screen work. Companion to
[`UI_PORT.md`](UI_PORT.md), which is the area-by-area port plan and progress
log. Read that first for the adopted shared layer, the route map and the
per-area definition of done.

Branch: `roadmap-4/ui-app3` (based on `roadmap-4/work`), tip `7cfbf12a`.
`sheetbase-app-3` is the frozen reference, not a live target.

This document answers one question: **the app-3 port is done; what screen work
is left, and what is ELN-specific and therefore has no app-3 screen to copy?**
The ELN-specific surfaces (section 2) need screens **designed**, not ported.

---

## 1. What is already done

All app-3-mapped areas are ported, wired to real data through the same-origin
`/api/db` proxy (or session-preserving server functions), and on the v3 kit:
Home, Inbox, Projects, Schedule, Search (incl. the ⌘K palette), Samples,
Materials, Experiments, Datasets, Templates, Models, Pipelines, Analysis saved
view, Protocols, Review, Evidence, Sheets, Import, Settings, Client portal,
Scan, Instruments.

`src/components/ui` (the legacy kit) now backs **only** the ELN-only legacy
routes in section 3.

Capabilities built DB-first (migration → RLS → RPC → data module → screen),
each with success / denied / other-workspace / stale contract tests:

| Capability                             | Migration      |
| -------------------------------------- | -------------- |
| Project members + folders              | (earlier)      |
| Signature certification                | `0248`, `0249` |
| Client portal (role, shares, projects) | `0250`, `0252` |
| Client invitations                     | `0251`         |
| Client portal messages                 | `0253`         |
| Display ids (MDL/TPL/SHT/AN)           | `0254`, `0255` |
| Record aliases                         | `0256`         |
| Instrument calibration                 | `0257`         |

Acceptance at the last full run: `test:screens` 49 routes × 2 widths, 0
problems; `test:crawl` 248 pages, 0 problems, 0 404s; `test:areas`,
`test:phone`, `test:interactions` green; `pnpm validate` green; unit 3298 pass;
`pnpm test:db` green; `db:generate` clean.

---

## 2. Ported ELN surfaces with **no app-3 screen** — design these

These are working, data-backed ELN surfaces that app-3 does not have. There is
no fixture contract to copy; they need screens designed in the v3 language.

| Route                                   | What it is                                                               | Why app-3 lacks it                                                                                          | Current code                                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `/analysis`                             | **Analysis Studio** — chart builder / Analyse / Compare authoring        | app-3 only has `/analysis/$analysisId` (a saved-view viewer); no studio                                     | `src/routes/analysis.tsx`; `src/components/viz/*`; `src/components/assist/analysis-figure-guide.tsx` |
| `/pipelines/agents`                     | **Agent operations** — Workflows / Proposals / Policies, approve/execute | app-3 has no agent surface                                                                                  | `src/components/v3/pipelines/`                                                                       |
| `/instruments`                          | **Instrument registry list** — ID, name, type, model, connection, search | app-3 only has `/instruments/$instrumentId` (no list)                                                       | `src/components/v3/instruments/`                                                                     |
| `/templates/$templateId/versions`       | **Template versions** — publish/retire, revision-checked                 | app-3 template detail is Sections-only                                                                      | `src/routes/templates/$templateId/versions.tsx`                                                      |
| `/templates/$templateId/in-use`         | **Template in use** — records pinned to a version                        | app-3 has no in-use tab                                                                                     | `src/routes/templates/$templateId/in-use.tsx`                                                        |
| `/records/$recordId/notebook`           | **Canonical record notebook** — the ELN's notebook surface               | app-3's notebook is `/experiments/$expId/notebook`; its `/records/$recordId` is a generic model-record page | `src/routes/records/$recordId/notebook.tsx`; `src/components/notebook/*`; `src/components/record/*`  |
| `/protocols/$protocolId` → **Training** | Controlled document + training                                           | app-3 has the tab; ELN states it as a gap                                                                   | `src/routes/protocols/$protocolId.tsx`                                                               |
| vendored v3 cmdk **command** primitive  | Backs the searchable record pickers                                      | app-3 has no command primitive                                                                              | `src/components/v3/ui/command.tsx`                                                                   |

**Same screen, different param** (no new design needed): `/evidence/$revisionId`
(app-3 `/evidence/$expId`), `/review/$revisionId` (app-3 `/review/$expId`),
`/settings/integrations/$connectorId` (app-3 `$integrationId`).
`/pipelines/runs/$runId` is a redirect alias.

### Per-screen brief template

For each row above, capture: **route** · **purpose** · **who uses it** ·
**data reads/writes** (real RPC/table) · **capabilities needed** (link the
DB-first build) · **states** (loading / empty / denied / stale) · **acceptance**
(screens route + area/interaction script). Where a capability is missing, the
screen ships the honest gap state, not a fixture.

---

## 3. app-3 screens **not yet ported**

Port these onto the v3 kit and wire to real data, exactly as the finished areas
were.

| app-3 route                   | Status     | Note                                                                                                                                                   |
| ----------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/models/$modelId/records`    | unported   | ELN maps this to `/models/$modelId/datasets` (a model's instances are datasets in the ELN registry). The app-3 **individual record** concept is a gap. |
| `/models/$modelId_/new`       | unported   | "New record" form for a model — same record/measurement gap.                                                                                           |
| `/readings/new`               | unported   | Bench reading entry (MOB-02).                                                                                                                          |
| `/records/$recordId`          | repurposed | ELN uses the path as a layout + notebook; app-3's values/history **model-record page** is unported.                                                    |
| Client portal **Reports** tab | unported   | app-3 portal has Projects/Reports/Messages; ELN has Projects + Messages. Reports is the last portal gap.                                               |
| `/import/$importId`           | folded     | ELN keeps one `/import` route; there is no server-side import-job model to page through. Documented, not a gap.                                        |
| `/_app/dev/components`        | skip       | dev-only.                                                                                                                                              |

---

## 4. ELN routes **to go** (retire)

Delete each route, its components, stories and tests when its replacement lands,
per DEC-03 and the UI port's "no parallel UI" rule.

| Route                         | Superseded by                   | Blocker                                                                                                                                   |
| ----------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `/admin`, `/admin/$section`   | `/settings/*` (SET-04.1)        | Remaining admin sections (diagnostics, connectors, usage, audit explorer, model fields, API credentials) not all folded into settings yet |
| `/configure`                  | `/models`                       | MDL-02 model editor not built                                                                                                             |
| `/planner`                    | folds into PROJ-02 (milestones) | PROJ-02 not built                                                                                                                         |
| `/help`                       | —                               | ELN-only, no app-3 equivalent; retire or redesign                                                                                         |
| `/sign-in`                    | —                               | ELN auth; app-3 has none — keep                                                                                                           |
| `/docs/$name`, `/foundations` | —                               | Internal, kept by DEC-03                                                                                                                  |

When the four routes above are gone, the legacy shell
(`src/components/shell/shell.tsx`) and the legacy kit (`src/components/ui/`) can
be deleted too.

---

## 5. Capability gaps (stated honestly in the UI)

Each needs a DB-first build (contract test → migration + RLS + RPC → data module
→ wire the screen) before its screen can show real data.

1. **Sample measurements** — `/samples/$sampleId/measurements`
2. **Experiment curated results** — `/experiments/$expId/results`
3. **Model record / measurement kind** — `/models/$modelId/records`, `/models/$modelId_/new`
4. **Client portal Reports**
5. **Protocol controlled document + training**
6. **Pipeline step editor** — `/pipelines/$pipelineId` Overview is read-only stored config
7. **MOB-02 bench reading** — `/readings/new`
8. **Inbox** data-issue / material / signature kinds (arrive with their capabilities)
9. **Search** multi-type filtering — currently client-side over the top 100 results
10. **Experiment open issues** — the model carries no count
11. **Settings instruments** — the page still carries a stale "calibration has no model" comment; the calibration capability exists on `/instruments/$instrumentId` (`0257`)

---

## 6. Notes for whoever designs/ports these screens

- **Where the UI lives:** ported components are under `src/components/v3/<area>/`;
  the shared kit is `src/components/v3/ui/`; tokens come from the bridge in
  `src/styles.css` (`--color-*`). A new ported route must be added to
  `v3RouteIds` in `src/routes/__root.tsx`, or it renders in the legacy shell.
- **Data boundary:** reads/writes go through the same-origin `/api/db` proxy or
  a session-preserving server function. Never ship a fixture.
- **The dev DB is thin:** the current dev workspace has no datasets, models,
  pipelines or templates (only a sheet instance), so dataset-dependent screens
  render empty states. `pnpm db:seed:month` is broken (it inserts membership
  into a workspace no seed creates). Create data through the RPCs when a screen
  needs it.
- **Known dev artifacts:** auth-free Better Auth `list-sessions` 401 on
  `/settings/profile` (ignored by the suites); the legacy notebook route
  intermittently logs React "Maximum update depth exceeded" (the page renders
  correctly; the suites tolerate exactly that message).
- **Acceptance:** `pnpm test:screens`, `test:crawl`, `test:areas`, `test:phone`,
  `test:interactions`, run against one auth-free `pnpm dev` with
  `SHEETBASE_RATE_LIMIT_MAX=100000`. Add new static routes to
  `tests/browser-scripts/screens.mjs`.
- **Two base-ui gotchas found while porting:** a `Button` rendered as a link
  needs `nativeButton={false}`; a `MenuGroupLabel` must sit inside a
  `Menu.Group` or the menu throws.
- **Before pushing:** `pnpm validate`; plus `pnpm test:db` when SQL changed;
  keep `pnpm db:generate` clean; run `pnpm roadmap:sync` and commit the tracker
  with the work.
