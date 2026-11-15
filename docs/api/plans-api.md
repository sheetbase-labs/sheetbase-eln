# Plans API

A plan is several changes approved once and run in order, so a request such as
"create an experiment, log ten samples for it, then add an analysis" needs one
approval, not one per card. Plans are on every surface: the assistant, MCP and
the Python SDK (see [lab-api.md](lab-api.md) for scopes and how tokens work).

A plan keeps no state of its own. There is no plan table and no plan event:
each step is an ordinary action and emits its own change events (for example
`experiment.created`, `sample.logged`), so webhooks and the audit trail already
say exactly what happened.

## What may pause, and what may power through

The workspace decides, with the other agent permissions (Settings → AI → Agent
permissions → **Plans**). Both rules are set per everyone, role or credential,
like any agent action.

| Rule                     | Ask (the default)                                        | Auto                             | Never                          |
| ------------------------ | -------------------------------------------------------- | -------------------------------- | ------------------------------ |
| `plan_pause_destructive` | Steps that remove or end something wait for their own OK | Every step runs straight through | Such steps cannot be in a plan |
| `plan_run_all`           | No **Run all** button                                    | **Run all** is offered           | No **Run all** button          |

Steps that are a person's own decision (signing, approving, deciding, releasing
a sample, acknowledging a protocol) never run inside a plan. The assistant
offers each as a card of its own once the plan has run.

## Assistant

The assistant proposes one plan card listing every step (`sheetbase.plan.propose`,
2 to 12 steps). Nothing happens until a button is pressed. **Approve plan** runs
the steps in order as the signed-in person; each step is built when its turn
comes, so a later step finds what an earlier one made (the experiment, the
samples). The plan stops at the first step that fails; earlier steps stay done
and the rest are skipped.

## MCP: `sheetbase.lab.plan`

Takes `steps`, each `{ "key", "action", "arguments" }`, where `action` is any
action `sheetbase.lab.act` takes. A value in `arguments` may be
`{ "$ref": "<step key>.<path>" }` to use part of an earlier result, such as
`experiment.id`.

Each step goes through the same agent permissions as `sheetbase.lab.act`: Auto
runs now, Ask creates a request and the plan stops there as
`waiting_for_approval`, Never is refused. Needs a personal token with the
scopes the actions need.

```json
{
  "steps": [
    {
      "key": "experiment",
      "action": "plan_experiment",
      "arguments": { "p_plan": {} }
    },
    {
      "key": "samples",
      "action": "log_samples",
      "arguments": { "p_experiment": { "$ref": "experiment.id" } }
    }
  ]
}
```

The report is `{ "status": "done" | "waiting_for_approval" | "failed", "steps": [...] }`
with each step `done` (and its result), `waiting_for_approval`, `failed` or
`not_run`.

## Python SDK

`client.plans.run(steps)` (and `await client.plans.run(steps)` on the async
client) runs `{ "key", "rpc", "arguments" }` steps in order with the same
`$ref` rule and the same report. Each RPC runs as the person the token belongs
to and under that token's scopes.
