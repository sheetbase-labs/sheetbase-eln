# Agent permissions API

What agents may do on their own, the agents on the Agents page, their signed
policies, the operation policies that let a service credential run drafts on its
own, the requests agents make and the AI switches are reachable with a token,
over MCP, from the assistant, in pipelines, through webhooks and in the steward
SQL views (see [lab-api.md](lab-api.md) for scopes and how tokens work).

## The one rule: tighten anywhere, widen only in the app

An agent must never give itself more room. So:

- **A person in the app** (a signed-in browser session) changes any of these as
  before.
- **Anyone else** — a personal or service token, MCP, a plugin running on its
  own, a pipeline run — may only **tighten**: set an action to Never, take Auto
  down to Ask, switch an agent off, switch an AI feature off, turn an operation
  policy off. Anything wider answers `403` with the hint to ask instead.
- **To widen, ask.** Call `request_agent_action` with the action (for example
  `set_agent_action_policy` and its arguments). It always waits for someone who
  manages the AI settings, who approves it in the Inbox or on the Agents page;
  it then runs as that person. These actions can never be set to Auto, so the
  wait cannot be switched off by the same route:
  `set_agent_action_policy`, `set_agent_definition_enabled`,
  `disable_agent_operation_policy`, `update_workspace_ai_feature_flags` and
  `update_workspace_ai_settings`.

What stays with a person in the app, and is not on the token API:
`decide_agent_action` (approving or rejecting a request; the assistant offers it
as a card the person presses), `decide_agent_operation`,
`execute_agent_operation` and `sign_agent_operation` (proposals),
`change_agent_policy` and `create_agent_operation_policy` (both need an
electronic signature) and `resume_agent_workflow` (pausing and cancelling are
open).

- Reads need `lab:read`; actions need `lab:write`. Actions run as the person a
  **personal token** belongs to and need their access: AI settings (manage) for
  `set_agent_action_policy`, the agent's owner, an admin or a steward for
  `set_agent_definition_enabled`, an admin or steward for
  `disable_agent_operation_policy`. A service credential has no person, so the
  actions refuse it; it can still read the tables and ask with
  `request_agent_action`.
- Over MCP, actions run through `sheetbase.lab.act` and tables through
  `sheetbase.canonical.read`.
- Webhook events: `agent.policy.changed`, `agent.action.requested`,
  `agent.action.decided`, `agent.action.completed`, `agent.enabled`,
  `agent.disabled`, `agent.signed_policy.changed`,
  `agent.operation_policy.created`, `agent.operation_policy.disabled`,
  `agent.proposal.created`, `agent.proposal.updated`,
  `agent.workflow.created` and `agent.workflow.updated`. See
  [event-catalogue.md](event-catalogue.md).
- Steward SQL views (read-only SQL login): `agent_action_policies`,
  `agent_action_requests`, `agents`, `agent_runs`, `agent_policy_revisions`,
  `agent_operation_policies`, `agent_proposals`, `agent_workflows` and
  `ai_checks`.

## Tables

| Table                      | What it holds                                                                                                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent_definitions`        | The agents on the Agents page: what starts them (`trigger_label`), who owns them, which projects they cover, what they read and propose, their `policy` and whether they are `enabled`. |
| `agent_runs`               | Each time an agent ran: `outcome` (`proposed`, `no_change`, `sent` or `failed`), a summary and the proposal it made, if any.                                                            |
| `agent_policy_revisions`   | The numbered revisions of the agents' policy: what changed, why, and the meaning of the signature that approved it.                                                                     |
| `agent_operation_policies` | Signed policies that let one service credential run one kind of draft on its own, within `limits`.                                                                                      |

`agent_action_policies` and `agent_action_requests` are described in
[lab-api.md](lab-api.md).

## Actions

### `set_agent_action_policy`

Set what agents may do with one action: `auto` (runs straight away), `ask`
(waits for a person) or `never`, for everyone, one role or one service
credential. `default` removes the setting; with none the answer is `ask`.
Signing, submitting for review, amending, locking and deleting are always
Never. With a token or in a pipeline this can only tighten. Returns the setting.
Sends `agent.policy.changed`.

Scope: `lab:write`.

| Argument           | Type |                                                           |
| ------------------ | ---- | --------------------------------------------------------- |
| `p_workspace_id` * | uuid | Your workspace id.                                        |
| `p_action_key` *   | text | The action, such as `start_stocktake`.                    |
| `p_level` *        | text | `auto`, `ask`, `never` or `default`.                      |
| `p_subject_kind`   | text | `everyone` (the default), `role` or `credential`.         |
| `p_role`           | text | The role, when the subject is a role.                     |
| `p_credential_id`  | uuid | The service credential, when the subject is a credential. |

```bash
# Stop agents placing reagent orders on their own, from a script
curl -X POST "$SHEETBASE/api/db/rpc/set_agent_action_policy" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"p_workspace_id":"…","p_action_key":"request_reagent_order","p_level":"never"}'
```

### `set_agent_definition_enabled`

Switch an agent on the Agents page on or off. Its owner, an admin or a steward
can. With a token or in a pipeline it can only be switched off. Returns the
agent. Sends `agent.enabled` or `agent.disabled`.

Scope: `lab:write`.

| Argument            | Type |                                                   |
| ------------------- | ---- | ------------------------------------------------- |
| `p_definition_id` * | uuid | The agent.                                        |
| `p_enabled` *       | bool | `true` to switch it on, `false` to switch it off. |

### `disable_agent_operation_policy`

Turn off a policy that let one service credential run one kind of draft on its
own; from then on its drafts wait for a person. Needs an admin or steward.
Returns the policy. Sends `agent.operation_policy.disabled`.

Scope: `lab:write`.

| Argument           | Type |                    |
| ------------------ | ---- | ------------------ |
| `p_workspace_id` * | uuid | Your workspace id. |
| `p_policy_id` *    | uuid | The policy.        |

### Asking for more room

```bash
# Ask a person to let agents start stocktakes on their own
curl -X POST "$SHEETBASE/api/db/rpc/request_agent_action" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"p_workspace_id":"…","p_action_key":"set_agent_action_policy",
       "p_arguments":{"p_workspace_id":"…","p_action_key":"start_stocktake","p_level":"auto"},
       "p_summary":"Let agents start stocktakes on their own",
       "p_provenance":{"agentId":"stock-bot"},"p_idempotency_key":"widen-stocktake-1"}'
```

The answer has `status: "pending"`. Follow it with the `agent.action.decided`
and `agent.action.completed` webhooks, or read it back from
`agent_action_requests`.
