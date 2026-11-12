/**
 * Recording a push of the version file as an operation: one declaration gives
 * the token API entry, the MCP action and the SDK method (see
 * `docs/development/adding-an-operation.md`).
 *
 * The push itself is `sheetbase push` or the SDKs' `push_version_file`: they
 * read the file, then save the draft through the existing draft operations.
 * Recording says who pushed, when, and from which commit; it never changes the
 * draft's configuration or revision and never publishes.
 */
import { defineOperations, input } from '#/lib/operations/descriptor'
import type { OperationInput } from '#/lib/operations/descriptor'

const described = (
  name: string,
  type: OperationInput['type'],
  description: string,
  required = true,
): OperationInput => ({ ...input(name, type, required), description })

export const VERSION_FILE_OPERATIONS = defineOperations([
  {
    name: 'record_pipeline_version_push',
    label: 'Record a version file push',
    summary: 'Record a push of the version file on a draft',
    description:
      'Says that the version file was just pushed into this draft: who pushed it (the person the token belongs to), when, and the commit it came from if given. The editor shows it as "Last push". Changes nothing else, and never publishes. Only a draft can be pushed to. Returns the draft version.',
    kind: 'write',
    scope: 'pipelines:write',
    inputs: [
      {
        ...input('p_workspace_id', 'uuid'),
        server: 'workspace',
        description: 'Your workspace id.',
      },
      described(
        'p_version_id',
        'uuid',
        'The draft version, from `pipeline_definition_versions`.',
      ),
      described(
        'p_commit',
        'text',
        'The commit the file came from, such as a git hash. Up to 80 characters.',
        false,
      ),
    ],
    result: 'row:pipeline_definition_versions',
    events: [],
  },
])
