# Planner API

The planner turns a goal into an experiment: from a protocol when one fits, with
its parts, a plate layout, a worklist for a liquid handler, samples to set aside
and, if asked, a request for a schedule. A plan is only a description. Nothing
exists until a person presses Create experiment, and then everything is made
together or not at all. The result is an ordinary experiment in a project; there
is nothing else to manage afterwards.

## Create an experiment from a plan

In the app, **Plan with AI** on Experiments asks the assistant, shows the plan to
read and, on **Create experiment**, makes the experiment. From a script, send a plan
of your own:

```
POST /api/db/rpc/create_planned_experiment
{ "p_project_id": "…",
  "p_plan": {
    "summary": "Eight doses in triplicate, read on the plate reader.",
    "experiment": { "title": "Compound X dose response", "templateRecordId": "<protocol id>" },
    "parts": [ { "title": "Seed", "dayOffset": 0, "handsOnMinutes": 60, "waitAfterMinutes": 1440,
                 "needs": [ { "instrumentId": "<instrument id>", "minutes": 30 } ] } ],
    "plate": { "name": "Dose plate", "format": "96_well", "wells": [ { "wellCode": "A1", "role": "blank" } ] },
    "worklist": { "format": "csv", "mode": "stamp", "sourcePlate": "Stock", "transfers": [] },
    "samples": [ { "recordId": "<sample id>", "quantity": 50, "unit": "µL" } ],
    "schedule": true, "warnings": [] } }
```

A part after the first may carry `"gate": "warn"` or `"block"`: it opens only when
the part before it is done (a gate, as on any multi-part experiment).

The call returns `{ recordId, identifier, plateRunId, worklistId, proposalId, parts,
reservations }`. The experiment, its parts, the plate run, the worklist, the sample
reservations and the schedule request are created in one transaction as the caller,
through the same functions the pages use, so every permission and rule still applies.
If any step is refused nothing is created. Booking still needs a person to accept the
schedule proposal.

Events: the experiment, plate run and reservations send their usual events
(`record.created`, `plate.run.created` and so on); the planner sends none of its own.
In the assistant: the **Plan experiment** card (`sheetbase.planner.plan_experiment`),
whose button is **Create experiment**. A pipeline step does not create planned
experiments; that is for a person.
