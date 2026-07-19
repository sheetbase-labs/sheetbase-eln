# 0013. Audit and approval components as presentational, display-only

- **Status:** accepted
- **Date:** 2026-07-19
- **Ticket:** UI-007

## Context

The concept `audit-trail.tsx` and `approval-stepper.tsx` were visual demos
with hard-coded events and a single inline workflow. Product needs them as
reusable inspector surfaces that render real audit data and the current
immutable review state, without embedding the commands that mutate that
state (approve, reject, return, reassign). They must stay usable inside the
narrow inspector column when histories and workflows are long, and they must
communicate status through text and icon, not connector colour alone.

Forces:

- Audit events and review state are owned by the route/store. The display
  components must be presentational and never mutate.
- Long audit histories and many-step workflows must not blow out the
  inspector; they need a capped scroll region and continuation.
- Screen-reader users must hear a complete sentence per event/step rather
  than inferring status from decorative connector lines.
- Missing data (deleted/unknown actor, unknown event type, pending step)
  must be rendered honestly, not hidden.

## Decision

1. **One module.** `src/components/audit/` with `AuditTrail`,
   `ApprovalStepper` and a barrel `index.ts`.

2. **AuditTrail is presentational.** It accepts a typed `AuditEvent[]`
   (id, type, title, optional `actor` with `unknown` flag, `timestamp`,
   optional `target`, optional override `icon`). It never mutates review
   state. `loading` renders a skeleton list; an empty array renders an
   honest "No activity yet" hint. `totalCount` plus `onLoadMore` renders a
   "Load more (N left)" continuation control and a "Showing N of M" count.
   The list is a scroll-capped `<ol>` (`maxHeight`, default `24rem`) so long
   histories stay usable inside an inspector.

3. **ApprovalStepper is presentational.** It accepts a workflow definition
   (`ApprovalStepDef[]`: id, title, optional role) and an immutable
   `reviewState: Record<stepId, ApprovalStepStatus>` (state + optional
   actor/at). Missing entries are pending. States are `pending`, `active`,
   `completed`, `rejected`, `returned`, `unavailable`, each with its own
   icon, label and colour so status is communicated by text + icon + colour,
   not connector colour alone. The list is a scroll-capped `<ol>`
   (`maxHeight`, default `20rem`) so long workflows stay usable.

4. **Screen-reader sentences.** Each event and step renders a complete
   `sr-only` sentence built from the typed data, e.g. "Gareth Price
   experiment created on Protocol EXP-2174 at 2025-07-14 09:12." and
   "Scientific review: returned by Emma Liu at 2025-07-15 15:20.". Connector
   lines are `aria-hidden` decoration.

5. **Honest missing data.** An `actor.unknown` renders as "Unknown user" in
   the visible label and "Someone"/"someone" in the sr-only sentence; a
   missing actor renders as "System". Unknown event types fall back to the
   `History` icon. Unknown step state falls back to `pending`.

6. **Display is separate from commands.** Neither component accepts
   approve/reject/return/reassign handlers. The route that owns review state
   renders action buttons alongside `ApprovalStepper`; the stepper only
   reports the current state.

## Consequences

- `/foundations` gains an "Audit trail & approval workflow" section showing
  a populated audit trail with continuation, loading and empty states, plus
  three stepper states (returned, active, rejected-at-QA) with unavailable
  downstream steps.
- Inspector routes compose `AuditTrail` over their audit feed and
  `ApprovalStepper` over their review state; the action surface lives in the
  route. No component imports sample data.
- UI-008 establishes the component gallery/visual review gate that includes
  these components across their states.
