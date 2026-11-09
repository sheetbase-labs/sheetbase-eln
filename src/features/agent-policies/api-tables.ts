import type { LabTable } from '#/lib/lab-api-surface'

/**
 * The agent lists on the external API, read with `lab:read`. What agents may
 * do (`agent_action_policies`) and their requests (`agent_action_requests`)
 * were already readable; this adds the agents themselves, their runs, their
 * signed policy history and the operation policies.
 */
export const AGENT_POLICY_LAB_TABLES = {
  agent_definitions: {
    summary:
      'The agents on the Agents page: what starts them (`trigger_label`), who owns them, which projects they cover, what they read and propose, their `policy` and whether they are `enabled`. Switch one on or off with `set_agent_definition_enabled`.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['display_id', 'text', 1],
      ['name', 'text', 1],
      ['kind', 'text', 1],
      ['description', 'text', 1],
      ['trigger_label', 'text', 1],
      ['project_ids', 'uuid[]', 1],
      ['owner_user_id', 'text', 0],
      ['model_label', 'text', 0],
      ['reads', 'text[]', 1],
      ['proposes', 'text', 0],
      ['enabled', 'bool', 1],
      ['policy', 'json', 1],
      ['created_at', 'ts', 1],
      ['updated_at', 'ts', 1],
    ],
  },
  agent_runs: {
    summary:
      'Each time an agent ran: `outcome` (`proposed`, `no_change`, `sent` or `failed`), a summary and the proposal it made, if any.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['definition_id', 'uuid', 1],
      ['run_number', 'int', 1],
      ['outcome', 'text', 1],
      ['summary', 'text', 1],
      ['detail', 'text', 1],
      ['proposal_id', 'uuid', 0],
      ['started_at', 'ts', 1],
    ],
  },
  agent_policy_revisions: {
    summary:
      'The numbered revisions of the agents’ policy: what changed, why, and the meaning of the signature that approved it. Changes are signed in the app.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['revision', 'int', 1],
      ['summary', 'text', 1],
      ['change_ref', 'text', 0],
      ['reason', 'text', 1],
      ['changed_by_user_id', 'text', 0],
      ['signed_meaning', 'text', 0],
      ['changed_at', 'ts', 1],
    ],
  },
  agent_operation_policies: {
    summary:
      'Signed policies that let one service credential run one kind of draft on its own, within `limits`. Turn one off with `disable_agent_operation_policy`; turning one on is signed in the app.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['name', 'text', 1],
      ['operation_kind', 'text', 1],
      ['target_type', 'text', 1],
      ['target_id', 'uuid', 0],
      ['limits', 'json', 1],
      ['enabled', 'bool', 1],
      ['credential_id', 'uuid', 1],
      ['reason', 'text', 0],
      ['signed_by_user_id', 'text', 0],
      ['signed_meaning', 'text', 0],
      ['signed_at', 'ts', 0],
      ['created_by_user_id', 'text', 1],
      ['updated_by_user_id', 'text', 1],
      ['created_at', 'ts', 1],
      ['updated_at', 'ts', 1],
    ],
  },
} as const satisfies Readonly<Record<string, LabTable>>
