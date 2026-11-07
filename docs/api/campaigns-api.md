# Campaigns API

A campaign optimises what you vary, round by round. It is an ordinary record of a
model ticked as a **Campaign list** (Models, Quality), so it has its own
fields, links and history. Each round the optimiser proposes a batch of
conditions, the planner lays them out as a plate and worklist, results come back
and the model learns from them. A person approves each round; nothing is made
before that.

## Set up

```
POST /api/db/rpc/set_model_campaign_list  { "p_model_key": "campaign", "p_enabled": true }
POST /api/db/rpc/configure_campaign
{ "p_record_id": "<campaign record>",
  "p_factors": [ { "key": "temp", "label": "Temperature", "kind": "continuous", "min": 20, "max": 40, "unit": "°C" },
                 { "key": "buffer", "label": "Buffer", "kind": "categorical", "values": ["a", "b", "c"] } ],
  "p_objectives": [ { "key": "yield", "label": "Yield", "direction": "maximise", "unit": "%" } ],
  "p_batch_size": 8, "p_max_rounds": 5, "p_max_runs": 40, "p_engine": "auto",
  "p_layout": { "plateFormat": "96_well", "replicates": 3, "blanks": 3, "negatives": 3,
                "positives": 3, "volumeUl": 50, "worklistFormat": "csv" },
  "p_template_record_id": null, "p_auto_propose": true, "p_seed": 1 }
```

Factors are `continuous` (a `min` and `max`), `discrete` (numbers in `values`) or
`categorical` (words in `values`). An objective is `maximise`, `minimise` or
`target` (with the `target` to hit); `weight` balances several. The factors and
objectives are fixed once a round has been asked for. Read campaigns from
`campaigns` and rounds from `campaign_rounds`.

## Run

```
POST /api/db/rpc/start_campaign           { "p_record_id": "…" }
POST /api/db/rpc/request_campaign_round   { "p_record_id": "…" }
POST /api/db/rpc/approve_campaign_round   { "p_round_id": "…" }
POST /api/db/rpc/reject_campaign_round    { "p_round_id": "…", "p_reason": "…" }
POST /api/db/rpc/record_campaign_results
     { "p_round_id": "…", "p_results": [ { "trial": 1, "results": { "yield": 71.2 } } ] }
POST /api/db/rpc/pull_campaign_round_results  { "p_round_id": "…", "p_objective_key": "yield" }
POST /api/db/rpc/set_campaign_status      { "p_record_id": "…", "p_status": "paused" }
```

A round goes `requested`, `proposing`, `proposed` (waiting for a person),
`approved` (waiting for results), then `completed`; or `rejected` or `failed`
(`error_message` says why). The optimiser works a requested round out within
seconds, so read it again until it is `proposed`. Approving makes the round's
experiment (joined to the campaign's series), its plate and, when `worklistFormat`
is set, its worklist. A round is complete when every condition has every result,
by hand or read from the plate's readings (the mean of a condition's wells); when
`p_auto_propose` is true the next round is then asked for. A campaign finishes when
its rounds or runs run out. Rejected and failed rounds do not use up the budget.

Each round records the optimiser that chose it (`engine`, `engine_version` and
`image_digest`) and why (`rationale`), so a round can be reproduced.

## Optimisers

`auto` uses [BayBE](https://emdgroup.github.io/baybe/) when the lab's Python
runtime has it and the built-in optimiser otherwise, so campaigns work with no
extra software. Add BayBE with `--build-arg WITH_BAYBE=true` when building
`docker/pipeline-python`, and give the runner enough memory with
`PIPELINE_PYTHON_MEMORY` (see [pipeline-python](../operations/pipeline-python.md)).
BayBE is about 1 GB at its peak, more than the 512 MiB default.

Events: `campaign.started`, `campaign.finished`, `campaign.round.proposed`,
`.approved`, `.rejected` and `.completed`. In the assistant: **Start campaign**,
**Ask for next round**, **Approve round** and **Enter results** cards. A pipeline
step can ask for a round with the **Propose next round** action
(`request_campaign_round`); approving stays with a person.

In the app: **Campaigns** under Methods.
