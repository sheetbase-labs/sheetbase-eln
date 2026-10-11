# Configuration depth

Five configuration surfaces are thinner than the designs they were adopted from.
Planned at `10a84a42`, 11 October 2026. Read [GUIDE.md](../GUIDE.md) and
[FINDINGS.md](../FINDINGS.md) section 9. Each task consumes an existing contract;
none of them should invent a new configuration model.

## R5-CONFIG-01: diagnostics and usage carry their evidence

**Outcome:** an administrator can quote a request ID, see when each check last
ran, see whether usage is approaching a limit, and break usage down by token.
Priority P2, effort M, low risk. Depends on whatever usage metering the
deployment actually has (see below).

**Current state and scope:** `src/routes/settings/diagnostics.tsx:262-284` shows
Time/Area/Message/Run with no request ID or copy affordance and no per-check
timestamps; `src/routes/settings/usage.tsx` has no trend, no plan limits or
warning thresholds and no per-token breakdown, and states plainly that some
meters are not built (`:254`). Scope: the two screens' evidence, not new
metering.

**Steps:**

1. Confirm which quantities the deployment can actually measure. Anything
   unmeasured keeps saying so — do not derive a number from a proxy and present
   it as metered.
2. Add the request ID (from the canonical request/correlation identity) with a
   copy affordance, and per-check "last run" timestamps from the real check
   records.
3. Add usage trends and thresholds only for measured quantities, with the plan
   limit sourced from configuration rather than hard-coded. Keep the "not built
   in this deployment" copy for the rest.
4. Make storage breakdown match the design's four kinds only if those kinds are
   real; otherwise keep the honest table and record the difference.

**Verification/exit:** component tests for the populated, empty and unmeasured
states; a test that a request ID shown in diagnostics resolves to the same
request in the logs; `pnpm validate`. No screen may show a number the deployment
cannot measure.

## R5-CONFIG-02: instruments declare how data arrives and when it last did

**Outcome:** registering an instrument records how its data arrives, and the
instrument record shows last data and next booking. Priority P2, effort M,
medium risk. Depends on the LAB-06 instrument/qualification contracts.

**Current state and scope:** the register dialog collects name/type/make/model/
serial/location only (`src/routes/instruments.tsx:815-845`); the inspector shows
last connected (`:634-637`) but no last data or next booking, and connection
health is a single `lastConnectedAt` rather than per-method. The design offers a
"How data gets in" choice (file drop, webhook, manual, not connected) with an
explicit "parser not validated" follow-up. Scope: instrument configuration and
its read model — not an instrument fleet platform.

**Steps:**

1. Decide the set of intake methods the product supports and what each one
   implies (who writes, with what provenance). Store it on the instrument and
   expose it in the API.
2. Extend the register/edit form with the method choice and the honest follow-up
   state (for example "parser not validated" where that is true).
3. Add last-data and next-booking to the inspector from existing booking and
   import records, and derive health per method rather than from a single
   timestamp.
4. Record what happens when an instrument's method changes: existing records
   keep their provenance.

**Verification/exit:** DB tests that the method persists and that changing it
does not rewrite historical provenance; component tests for the register form
and inspector states; `pnpm validate`. Do not add a connector registry: intake
methods are instrument configuration, not integrations.

## R5-CONFIG-03: model versions can be submitted for approval and merged safely

**Outcome:** a model change can be submitted for approval, edited further
without losing the submission, and reconciled when the model changed underneath.
Priority P1, effort L, high risk. Depends on MDL-03's publication decision.

**Current state and scope:** `src/routes/models/$modelId/edit.tsx` publishes
directly through the CORE-05 RPC. The design has an Approver choice and a reason
dialog, an "awaiting approval" state, stale/merge conflict handling
(Reload theirs / Merge and keep editing), section reordering and a field-editor
inspector with per-type configuration. Scope: the approval and conflict states
around the existing publication contract, plus section ordering (which is
mostly a schema-shape question).

**Steps:**

1. Confirm MDL-03's publication decision and who may approve. If approval is not
   in the accepted model, record that and reduce this task to the conflict and
   ordering work.
2. Add the submit-for-approval state without forking the draft: a submitted
   version remains editable as a draft, and the submission records who was asked
   and why.
3. Add stale/merge handling using the existing expected-revision pattern: never
   overwrite a version someone else changed, and offer an explicit route out.
4. Add section ordering and the per-type field configuration in the editor,
   reusing the field-definition shapes rather than inventing per-type options in
   the browser.

**Verification/exit:** DB tests for submit, approve, reject, edit-after-submit
and concurrent-edit conflict; component tests for the approval and conflict
states; `pnpm validate`. A published version must remain immutable, and a
conflict must never silently win.

## R5-CONFIG-04: template in-use and version history are inspectable

**Outcome:** a template shows which records use which version, what each version
changed, who signed it, and whether the in-use set is stale before publishing.
Priority P2, effort M, medium risk. Depends on SHEET-04 template governance.

**Current state and scope:** `src/routes/templates/$templateId/in-use.tsx`
renders a grouped table with no inspector, no project filter (the parameter is
parsed but unused), no per-version matrix; `versions.tsx` has no change set, no
signature list and no stale-publish banner (its `state` accepts `denied` only).
Scope: the two screens' evidence over the existing version/governance records.

**Steps:**

1. Confirm the version/governance records that already exist (who published a
   version, which records are on which version) and read from them rather than
   recomputing.
2. Add the records-by-version matrix and wire the project filter that is
   currently parsed but ignored. Keep denied and hidden-record behaviour
   explicit, with counts.
3. Add per-version change sets (added, changed, removed, with before → after)
   from the definition diff the upgrade path already computes.
4. Add the signatures list and the stale-publish banner: publishing on a stale
   view must be refused or explicitly confirmed, never silently applied.

**Verification/exit:** component tests for populated, empty, denied and stale
states on both screens; a DB test that the in-use matrix matches the records
actually pinned to each version; `pnpm validate`.

## R5-CONFIG-05: milestones carry scale, dependencies, risk and date history

**Outcome:** a plan can be read week by week, shows what depends on what, marks
at-risk milestones, and records who was told what and when. Priority P2, effort
L, medium risk. Depends on PROJ-02's milestone decisions.

**Current state and scope:** `src/routes/projects/$projectId/milestones.tsx:58`
accepts `denied`/`empty` only. The design adds a month/week scale with a today
marker, phase bars, dependency lines, client-visible rings, at-risk status,
start-from-template, a "next date the client sees" line, date history with who
was notified, and a stale 409 banner. Scope: the plan surface and its evidence —
not a project-planning engine.

**Steps:**

1. Confirm which milestone fields exist (dates, status, dependency, client
   visibility). Add fields only through a migration that keeps existing rows
   valid, and record any new meaning in the ADR or task that owns milestones.
2. Add the scale control and today marker, then phases, dependency lines and
   client-visible rings from real fields.
3. Add at-risk derivation with its rule stated in the UI, start-from-template
   (created through the canonical milestone RPCs), and the date history with
   notification evidence.
4. Handle the stale case: a plan edited elsewhere must fail with a 409-style
   conflict and an explicit reload path.

**Verification/exit:** DB tests for dependency cycles being refused, at-risk
derivation and date-history recording; component tests for the scale control,
empty, denied and stale states; `pnpm validate`. A dependency cycle must be
impossible to store.
