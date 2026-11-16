/**
 * The workspace rule for open steps and a missing decision before submission.
 * Declared once, so the API, the SDKs, MCP and the assistant all come from this
 * entry. The change is sent as `workspace.settings.updated`.
 *
 * It is not a pipeline action: a run that could switch the check off would let
 * automation loosen the guardrail that stops an unfinished experiment being
 * signed. Tokens and the assistant are allowed, as for any workspace rule: the
 * person they act for still needs Signatures settings access, and the
 * assistant waits for them to press the card.
 */
import { defineOperations, input } from '#/lib/operations/descriptor'

export const SUBMIT_READINESS_OPERATIONS = defineOperations([
  {
    name: 'set_submit_readiness_mode',
    label: 'Choose what open steps do before submission',
    summary: 'Say whether open steps and a missing decision stop a submission',
    description:
      'Workspace setting for experiments: `off` does not check protocol steps nobody finished or a missing decision, `warn` lists them on the experiment, in the submit dialog and for the reviewer but lets the submission through, and `block` lists them and refuses the submission until they are cleared. New workspaces start on `warn`. Needs Signatures settings access. Returns the workspace settings. Sends `workspace.settings.updated`.',
    kind: 'write',
    inputs: [
      {
        ...input('p_workspace_id', 'uuid'),
        server: 'workspace',
        description: 'Your workspace id.',
      },
      {
        ...input('p_mode', 'text'),
        description: '`off`, `warn` or `block`.',
      },
    ],
    result: 'row:workspace_settings',
    assistant: { tool: 'sheetbase.submit_readiness.set' },
  },
])
