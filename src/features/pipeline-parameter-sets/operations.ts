/**
 * Reusable parameter sets as operations: one declaration each gives the token
 * API entry, the MCP action, the assistant card name, the pipeline action and
 * the webhook events (see `docs/development/adding-an-operation.md`).
 *
 * A set is a named list of parameters a workspace keeps once and many
 * pipelines `include` by key. Saving or deleting one never changes a saved
 * version: a version that includes a set carries its own copy.
 */
import { defineOperations, input } from '#/lib/operations/descriptor'
import type { OperationInput } from '#/lib/operations/descriptor'

const described = (
  name: string,
  type: OperationInput['type'],
  description: string,
  required = true,
): OperationInput => ({ ...input(name, type, required), description })

const workspace = (): OperationInput => ({
  ...input('p_workspace_id', 'uuid'),
  server: 'workspace',
  description: 'Your workspace id.',
})

export const PARAMETER_SET_OPERATIONS = defineOperations([
  {
    name: 'save_pipeline_parameter_set',
    label: 'Save a parameter set',
    summary: 'Save a reusable parameter set',
    description:
      'Makes a parameter set, or replaces the one with the same key. `p_parameters` is a list of `{name, type, required, default, description}`, judged as a pipeline judges its own. Pipelines include it by key; versions already saved keep the copy they took. Stewards, admins and owners. Returns the set. Sends `pipeline.parameter_set.created` or `pipeline.parameter_set.updated`.',
    kind: 'write',
    scope: 'pipelines:write',
    inputs: [
      workspace(),
      described(
        'p_key',
        'text',
        'Lower-case letters, digits, `-` and `_`, starting with a letter.',
      ),
      described('p_name', 'text', 'Name.'),
      described('p_parameters', 'json', 'The parameters, as a list.'),
      described('p_description', 'text', 'What it is for.', false),
    ],
    result: 'row:pipeline_parameter_sets',
    assistant: { tool: 'sheetbase.pipeline_parameter_set.save' },
    pipeline: {},
    events: [],
  },
  {
    name: 'delete_pipeline_parameter_set',
    label: 'Delete a parameter set',
    summary: 'Delete a parameter set',
    description:
      'Deletes a parameter set. Versions that included it keep their copy of its parameters. Stewards, admins and owners. Sends `pipeline.parameter_set.deleted`.',
    kind: 'write',
    scope: 'pipelines:write',
    inputs: [
      workspace(),
      described('p_set_id', 'uuid', 'The set, from `pipeline_parameter_sets`.'),
    ],
    result: 'void',
    assistant: { tool: 'sheetbase.pipeline_parameter_set.delete' },
  },
])
