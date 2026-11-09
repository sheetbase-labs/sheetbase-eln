/**
 * Agent permissions as operations: one declaration each gives the token API
 * entry, the MCP action, the assistant card name, the pipeline action and the
 * webhook events (see `docs/development/adding-an-operation.md`).
 *
 * Away from the app (a token, MCP, a pipeline) these can only tighten what
 * agents may do. Widening is refused by the database, and an agent asks for it
 * with `request_agent_action`, which always waits for a person: see
 * `feature.ts` and migration `20261109171939_agent_policy_integrations.sql`.
 */
import { defineOperations, input } from '#/lib/operations/descriptor'
import type { OperationInput } from '#/lib/operations/descriptor'

const note = (
  name: string,
  type: OperationInput['type'],
  description: string,
  required = true,
  nullable = false,
): OperationInput => ({ ...input(name, type, required, nullable), description })

const card = (tool: string) => ({
  tool,
  presentation: 'card' as const,
  vocabulary: 'propose' as const,
})

const TIGHTEN_ONLY =
  'With a token or in a pipeline it can only tighten; to loosen, ask with `request_agent_action` and a person approves it in the app.'

export const AGENT_POLICY_OPERATIONS = defineOperations([
  {
    name: 'set_agent_action_policy',
    label: 'Set what agents may do',
    summary: 'Set what agents may do with an action',
    description: `Sets one action to \`auto\` (runs straight away), \`ask\` (waits for a person) or \`never\`, for everyone, one role or one service credential; \`default\` removes the setting. Signing, submitting for review, amending, locking and deleting are always Never, and changes to agent permissions can never be Auto. Needs AI settings access. ${TIGHTEN_ONLY} Returns the setting. Sends \`agent.policy.changed\`.`,
    kind: 'write',
    inputs: [
      note('p_workspace_id', 'uuid', 'Your workspace id.'),
      note('p_action_key', 'text', 'The action, such as `start_stocktake`.'),
      note('p_level', 'text', '`auto`, `ask`, `never` or `default`.'),
      note(
        'p_subject_kind',
        'text',
        '`everyone` (the default), `role` or `credential`.',
        false,
      ),
      note(
        'p_role',
        'text',
        'The role, when the subject is a role.',
        false,
        true,
      ),
      note(
        'p_credential_id',
        'uuid',
        'The service credential, when the subject is a credential.',
        false,
        true,
      ),
    ],
    result: 'row:agent_action_policies',
    assistant: card('sheetbase.agent_permission.set'),
    pipeline: {},
  },
  {
    name: 'set_agent_definition_enabled',
    label: 'Switch an agent on or off',
    summary: 'Switch an agent on or off',
    description: `Switches one of the agents on the Agents page on or off. Its owner, an admin or a steward can. ${TIGHTEN_ONLY} Returns the agent. Sends \`agent.enabled\` or \`agent.disabled\`.`,
    kind: 'write',
    inputs: [
      note('p_definition_id', 'uuid', 'The agent.'),
      note(
        'p_enabled',
        'bool',
        '`true` to switch it on, `false` to switch it off.',
      ),
    ],
    result: 'row:agent_definitions',
    assistant: card('sheetbase.agent.switch'),
    pipeline: {},
  },
  {
    name: 'disable_agent_operation_policy',
    label: 'Turn off an agent operation policy',
    summary: 'Turn off an agent operation policy',
    description:
      'Stops one service credential running one kind of draft on its own. From then on its drafts wait for a person. Needs a workspace admin or steward; works from a personal token or a pipeline too, since it only tightens. Turning one on needs a signature in the app. Returns the policy. Sends `agent.operation_policy.disabled`.',
    kind: 'write',
    inputs: [
      note('p_workspace_id', 'uuid', 'Your workspace id.'),
      note('p_policy_id', 'uuid', 'The policy.'),
    ],
    result: 'row:agent_operation_policies',
    assistant: card('sheetbase.agent_operation_policy.disable'),
    pipeline: {},
  },
  // Cards only. Deciding stays a person's act: the button runs in their own
  // browser session, and tokens and pipelines are refused.
  {
    name: 'decide_agent_action',
    label: 'Approve or reject what an agent asked to do',
    description:
      'Approves a waiting request and runs it as you, or rejects it with a reason.',
    kind: 'write',
    api: 'elsewhere',
    inputs: [
      note('p_request_id', 'uuid', 'The request.'),
      note('p_decision', 'text', '`approve` or `reject`.'),
      note('p_reason', 'text', 'Why, for a rejection.', false, true),
    ],
    result: 'row:agent_action_requests',
    assistant: card('sheetbase.agent_request.decide'),
  },
  {
    name: 'set_ai_features',
    rpc: 'update_workspace_ai_feature_flags',
    label: 'Switch AI features on or off',
    description:
      'Switches the assistant, and what outside tools may do over MCP, on or off. Switching one on is done by a person in the app.',
    kind: 'write',
    api: 'elsewhere',
    inputs: [
      note('p_workspace_id', 'uuid', 'Your workspace id.'),
      note('p_feature_flags', 'json', 'Every switch, true or false.'),
    ],
    result: 'row:workspace_settings',
    assistant: card('sheetbase.ai_features.set'),
  },
  // Already on the API (lab-api-surface.ts); declared here for the pipeline
  // action and the assistant card.
  {
    name: 'request_agent_action',
    label: 'Ask a person to approve an agent action',
    description:
      'Records an action for a person to approve, such as giving agents more room. What happens next depends on the setting for that action: refused (Never), waiting for a person (Ask) or ready to run (Auto). Changes to agent permissions always wait for someone who manages the AI settings.',
    kind: 'write',
    api: 'elsewhere',
    inputs: [
      {
        ...note('p_workspace_id', 'uuid', 'Your workspace id.'),
        server: 'workspace',
      },
      note(
        'p_action_key',
        'text',
        'The action, such as `set_agent_action_policy`.',
      ),
      note(
        'p_arguments',
        'json',
        'The arguments the action would be called with.',
      ),
      note('p_summary', 'text', 'One line a person reads before deciding.'),
      note(
        'p_provenance',
        'json',
        'Who is asking, such as `{ "agentId": "…" }`.',
      ),
      {
        ...note(
          'p_idempotency_key',
          'text',
          'A key so a retry gives back the same request.',
        ),
        server: 'idempotency',
      },
    ],
    result: 'row:agent_action_requests',
    pipeline: {},
  },
  {
    name: 'set_lab_watcher',
    label: 'Turn a lab watcher on or off',
    description:
      'Sets a watcher: its kind, whether it is on, how often it looks, an optional project and its settings. Returns the watcher.',
    kind: 'write',
    api: 'elsewhere',
    inputs: [
      note('p_workspace_id', 'uuid', 'Your workspace id.'),
      note(
        'p_kind',
        'text',
        '`stock_expiring`, `stock_low`, `work_overdue`, `data_missing` or `results_off`.',
      ),
      note('p_enabled', 'bool', 'On or off.'),
      note('p_schedule', 'text', '`hourly`, `daily` or `weekly`.', false),
      note('p_project_id', 'uuid', 'Limit it to one project.', false, true),
      note('p_params', 'json', '`days` or `sigma`.', false),
    ],
    result: 'row:lab_watchers',
    pipeline: {},
  },
  {
    name: 'run_lab_watcher',
    label: 'Run a lab watcher now',
    description:
      'Looks straight away instead of waiting for the schedule. Returns how many new findings were made.',
    kind: 'write',
    api: 'elsewhere',
    inputs: [note('p_watcher_id', 'uuid', 'The watcher.')],
    result: 'int',
    pipeline: {},
  },
  {
    name: 'set_watcher_finding_status',
    label: 'Dismiss or snooze a watcher finding',
    description:
      '`dismiss`, `snooze` (with a time in the future) or `reopen`. Returns the finding.',
    kind: 'write',
    api: 'elsewhere',
    inputs: [
      note('p_finding_id', 'uuid', 'The finding.'),
      note('p_action', 'text', '`dismiss`, `snooze` or `reopen`.'),
      note('p_until', 'ts', 'Until when, for a snooze.', false),
    ],
    result: 'row:lab_watcher_findings',
    pipeline: {},
  },
])
