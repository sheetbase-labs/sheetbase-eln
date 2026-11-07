# Robots API

An instrument can be a **robot**: Sheetbase sends it a worklist, the folder agent
on the lab computer puts the run on the robot, a person presses **Start**, and the
robot's log comes back as the worklist's completed transfers, the stock it used
and the lineage against the experiment.

## Set an instrument up as a robot

`set_instrument_robot` through `POST /api/db/rpc/set_instrument_robot`
(`lab:write`; needs permission to manage instruments):

```
{ "p_instrument_id": "…", "p_driver": "opentrons",
  "p_worklist_format": "opentrons",
  "p_labware": { "opentronsPipette": "p300_single_gen2", "opentronsMount": "left" } }
```

- `driver` is `opentrons` (the robot's HTTP API on your network) or `file` (the
  robot's own software reads worklists from a folder).
- `worklist_format` is `opentrons` for an Opentrons robot, or `csv`, `echo`,
  `tecan_gwl` or `hamilton` for a file robot.
- `labware` names what the file refers to: `opentronsSourceLabware`,
  `opentronsDestLabware`, `opentronsPipette`, `opentronsTiprack`,
  `opentronsMount`, `liquidClass`, `tecanSourceType`, `tecanDestType`,
  `echoSourceType`.

`clear_instrument_robot` removes the settings; jobs already sent stay on record.
Read settings from `instrument_robot_settings`.

The agent is downloaded from the instrument page (**Download agent** under
Robot) with its address or folder and its access key already in. It signs in
with a personal token and uses `POST /api/connectors/jobs` (below).

## Send a worklist, start it, stop it

```
POST /api/db/rpc/queue_instrument_job    { "p_instrument_id": "…", "p_worklist_id": "…", "p_note": "Fresh tips" }
POST /api/db/rpc/start_instrument_job    { "p_job_id": "…" }
POST /api/db/rpc/cancel_instrument_job   { "p_job_id": "…" }
```

A job moves `queued` (waiting for the agent) → `staged` (on the robot, waiting
for Start) → `starting` → `running` → `complete`, `failed` or `cancelled`. A
worklist has one open job at a time, and only a planned worklist can be sent.
**Start is for the person at the robot**: `start_instrument_job` only works on a
staged job and is attributed to whoever calls it, so scripts and the assistant
do not call it on someone's behalf. Cancelling a queued or staged job is
immediate; a running one is asked to stop and is `cancelled` once the agent
confirms.

When the robot finishes, the agent sends what it did. The worklist is completed
with those transfers (`done`, `short`, `failed`, `skipped` or `missing`), and
the samples drawn are withdrawn for the experiment the worklist belongs to, the
same as completing a worklist by hand. Read jobs from `instrument_jobs`:

```
GET /api/db/instrument_jobs?instrument_id=eq.<robot>&status=in.(queued,staged,running)
```

`result` has `transfers`, `byStatus` and `withdrawals` (`withdrawn`, `skipped`).

Events: `instrument.job.queued`, `.staged`, `.started`, `.completed`, `.failed`,
`.cancelled` (webhooks and the event stream; see the [event
catalogue](event-catalogue.md)). A pipeline step can send a worklist with the
**Send worklist to instrument** action (`queue_instrument_job`), and a pipeline
can start on `instrument.job.completed`.

## The agent's endpoint

`POST /api/connectors/jobs` is for the agent, with a personal token that has
`datasets:write`:

```
{ "action": "list",   "instrumentId": "…" }
{ "action": "report", "instrumentId": "…", "jobId": "…",
  "status": "staged" | "running" | "complete" | "failed" | "cancelled",
  "remoteRef": "…", "message": "…",
  "entries": [ { "sourceWell": "A1", "destWell": "B1", "actualUl": 20, "status": "ok" } ] }
```

`list` returns the open jobs for that robot, each with the worklist file to put
on the robot (rendered in the format the robot reads). `report` moves a job on;
a completing report carries what the robot moved (`entries`, or the robot's own
`runLog` text, which is read like a worklist log). Nothing else moves a job
forward: the agent cannot start a run, only put it on the robot and report.

In the assistant, **Send to robot** (`sheetbase.robot.send_worklist`) is a card
that queues the job and says it waits for Start.
