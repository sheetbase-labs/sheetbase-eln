/**
 * Publishing a pipeline version needs an admin's approval. A person (or the
 * token that belongs to them) asks with `request_pipeline_publish`; deciding
 * is an owner's or admin's own act in the app, so approving and returning
 * are not offered to tokens, MCP, the assistant or pipelines. Withdrawing the
 * request is the generic `withdraw_approval_request`.
 */
import { defineOperations, input } from '#/lib/operations/descriptor'

export const PIPELINE_APPROVAL_OPERATIONS = defineOperations([
  {
    name: 'request_pipeline_publish',
    label: 'Ask for a pipeline version to be published',
    summary: 'Ask for a pipeline version to be published',
    description:
      'Asks an admin or owner to approve publishing a checked draft version, with `p_reason` saying what changed. The draft is locked while the request waits; once an admin approves, that exact version is published and runs and schedules use it. Where the person asking is the only admin or owner, they may approve it themselves. Returns the request; read its state on `approval_requests` (`object_kind` is `pipeline_definition_version`). Sends `approval.requested`, then `approval.approved` or `approval.returned`, and `pipeline.version.published` once it is published. Approving or returning is a person’s decision in the app and is not offered here.',
    kind: 'write',
    scope: 'pipelines:write',
    inputs: [
      {
        ...input('p_workspace_id', 'uuid'),
        server: 'workspace',
        description: 'Your workspace id.',
      },
      {
        ...input('p_version_id', 'uuid'),
        description: 'The draft version, from `pipeline_definition_versions`.',
      },
      {
        ...input('p_reason', 'text'),
        description: 'What changed and why, up to 500 characters.',
      },
    ],
    result: 'row:approval_requests',
    assistant: { tool: 'sheetbase.pipeline.publish' },
  },
])
