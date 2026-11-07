# Planner API

The planner turns a goal into one reviewable plan: the experiment (from a
protocol when one fits), its parts, a plate layout, a worklist for a liquid
handler, samples to set aside and, if asked, a request for a schedule. Nothing
exists until a person applies the plan, and then everything is made together or
not at all.

## Draw up a plan

In the app, **Plan with AI** (Experiments, or the Plans page) asks the assistant
and saves the answer as a plan. From a script, save your own:

```
POST /api/db/rpc/create_experiment_plan
{ "p_project_id": "…", "p_goal": "Dose response of compound X on HEK293 cells",
  "p_plan": {
    "summary": "Eight doses in triplicate, read on the plate reader.",
    "experiment": { "title": "Compound X dose response", "templateRecordId": "<protocol id>" },
    "parts": [ { "title": "Seed", "dayOffset": 0, "handsOnMinutes": 60, "waitAfterMinutes": 1440,
                 "needs": [ { "instrumentId": "<instrument id>", "minutes": 30 } ] } ],
    "plate": { "name": "Dose plate", "format": "96_well", "wells": [ { "wellCode": "A1", "role": "blank" } ] },
    "worklist": { "format": "csv", "mode": "stamp", "sourcePlate": "Stock", "transfers": [] },
    "samples": [ { "recordId": "<sample id>", "quantity": 50, "unit": "µL" } ],
    "schedule": true, "warnings": [] },
  "p_source": "api" }
```

A part after the first may carry `"gate": "warn"` or `"block"`: on apply it opens
only when the part before it is done (a gate, as on any multi-part experiment).

Every id is checked when the plan is saved (the protocol is an active protocol,
instruments are live, samples have stock), and the plate and worklist must be
valid, so a bad plan is refused here and not half way through applying it.
Read plans from `experiment_plans`; `number` gives the reference `PLN-0003`.

## Apply or dismiss

```
POST /api/db/rpc/apply_experiment_plan     { "p_plan_id": "…" }
POST /api/db/rpc/dismiss_experiment_plan   { "p_plan_id": "…" }
```

Apply returns `{ recordId, identifier, plateRunId, worklistId, proposalId, parts,
reservations }`. The experiment, its parts, the plate run, the worklist, the sample
reservations and the schedule request are created in one transaction; if any step
fails, nothing is created and the plan stays waiting. Booking still needs a person
to accept the schedule proposal.

Events: `plan.proposed`, `plan.applied`, `plan.dismissed`. In the assistant: the
**Plan experiment** card (`sheetbase.planner.apply`). A pipeline step cannot apply
a plan; that is for a person.

In the app: **Plans** under Methods, and **Plan with AI** on Experiments (shown
when the lab has a real model connected).
