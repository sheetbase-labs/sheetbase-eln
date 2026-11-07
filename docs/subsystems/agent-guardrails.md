# Agent guardrails, checks and watchers

Three things that make it safe to let an agent work in the lab.

## Agent permissions

For every action an agent can take in the lab (the lab RPCs that change
something), an admin sets **Auto**, **Ask** or **Never** in Settings > AI >
Agent permissions. A setting can be for everyone, for one role or for one
service credential. The most specific one wins; with none set the answer is
Ask. Signing, submitting for review, amending, locking and deleting are
always Never.

- The decision is made in the database (`api.request_agent_action`,
  `api.resolve_agent_action_level`); `src/lib/agent-action-policy.ts` is the
  copy the screens read.
- `sheetbase.lab.act` over MCP (and the assistant) goes through
  `runGuardedLabAct` in `src/lib/mcp/lab.ts`. Auto runs now and records the
  outcome, Ask returns `waiting_for_approval` and lands in the Inbox, Never is
  refused. A repeat of the same pending request is not duplicated.
- A person approves in the Inbox; the action then runs as that person, so what
  they may not do still fails.
- The API: `agent_action_requests` (read), `request_agent_action`,
  `finish_agent_action`, `resolve_agent_action_level` ([lab API](../api/lab-api.md)).
  Policies themselves are read with an admin token (`agent_action_policies`).
  Changing them is a person's act and has no API.
- Events: `agent.policy.changed`, `agent.action.requested`,
  `agent.action.decided`, `agent.action.completed`.

## Checks (evals)

Settings > AI > Checks runs a fixed set of everyday tasks against a small
built-in lab and says which pass. Without a model it checks that the
assistant's tools answer correctly; with a connected model it also checks that
the model picks the right tool and proposes the right change. A run also
happens after the provider or model is changed. Results are kept as
`ai_eval_runs` and `ai_eval_results`. Event: `ai.eval.completed`.

Code: `src/lib/ai-evals.server.ts`, `ai-evals-run.server.ts`, route
`POST /api/ai/evals`.

## Lab watchers

Rule-based reviews that run on a schedule, with AI off or on: stock expiring,
stock low, work overdue, data missing, and results off. Each finding names the
record, is filed in the owner's Inbox and can be dismissed, snoozed or acted on
through its suggested action. A finding that stops being true resolves itself.

- Scheduler: `src/lib/lab-watcher-scheduler.server.ts` (every five minutes
  picks up due watchers; disabled under test).
- API: `lab_watchers`, `lab_watcher_findings`, `set_lab_watcher`,
  `run_lab_watcher`, `set_watcher_finding_status`.
- Event: `watcher.finding.created`, which can start a pipeline.
