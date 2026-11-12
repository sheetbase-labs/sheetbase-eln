/**
 * Pipeline connections as operations: the places a pipeline web call may
 * reach. One declaration each gives the token API entry, the MCP action, the
 * assistant card name and the webhook events.
 *
 * A connection holds an address and the names of its secrets, never their
 * values. Setting a secret is done in the app only (see `feature.ts`), and
 * there is no pipeline action: a pipeline must not change where pipelines may
 * send data.
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

const workspace = (): OperationInput => ({
  ...input('p_workspace_id', 'uuid'),
  server: 'workspace',
  description: 'Your workspace id.',
})

const card = (tool: string) => ({
  tool,
  presentation: 'card' as const,
  vocabulary: 'propose' as const,
})

export const PIPELINE_CONNECTION_OPERATIONS = defineOperations([
  {
    name: 'create_pipeline_connection',
    label: 'Add a pipeline connection',
    summary: 'Add a pipeline connection',
    description:
      'Approves an https address that pipeline web call steps may call, under a short key such as `lims`. The address has no password, query or fragment. Owners, admins and stewards. The secrets a call signs with are set in the app, by name, and are never readable. Returns the connection. Sends `pipeline_connection.created`.',
    kind: 'write',
    scope: 'admin:write',
    inputs: [
      workspace(),
      note(
        'p_key',
        'text',
        'What steps call it: lowercase letters, digits and hyphens, such as `lims`.',
      ),
      note('p_name', 'text', 'What people call it, such as `LIMS`.'),
      note(
        'p_base_url',
        'text',
        'The https address, such as `https://lims.example.com/api`.',
      ),
      note('p_description', 'text', 'What it is for.', false, true),
      note(
        'p_auth_header',
        'text',
        'The header a secret is sent in. Defaults to `Authorization`.',
        false,
      ),
      note(
        'p_auth_scheme',
        'text',
        'The word before the secret, such as `Bearer`. Empty sends the secret alone.',
        false,
      ),
    ],
    result: 'row:pipeline_connections',
    assistant: card('sheetbase.pipeline_connection.add'),
  },
  {
    name: 'update_pipeline_connection',
    label: 'Change a pipeline connection',
    summary: 'Change a pipeline connection',
    description:
      'Renames a connection, moves it to another address, or switches it off (`p_status` `off`) or on (`active`). Leave out what stays. A switched-off connection stops every web call that uses it. Owners, admins and stewards. Returns the connection. Sends `pipeline_connection.updated`.',
    kind: 'write',
    scope: 'admin:write',
    inputs: [
      workspace(),
      note(
        'p_connection_id',
        'uuid',
        'The connection, from `pipeline_connections`.',
      ),
      note('p_name', 'text', 'A new name.', false),
      note('p_base_url', 'text', 'A new https address.', false),
      note('p_description', 'text', 'A new description.', false),
      note('p_status', 'text', '`active` or `off`.', false),
      note('p_auth_header', 'text', 'The header a secret is sent in.', false),
      note('p_auth_scheme', 'text', 'The word before the secret.', false),
    ],
    result: 'row:pipeline_connections',
    assistant: card('sheetbase.pipeline_connection.change'),
  },
  {
    name: 'delete_pipeline_connection',
    label: 'Remove a pipeline connection',
    summary: 'Remove a pipeline connection',
    description:
      'Removes a connection and its sealed secrets. Refused while a published pipeline version still calls it. Owners, admins and stewards. Sends `pipeline_connection.deleted`.',
    kind: 'write',
    scope: 'admin:write',
    inputs: [
      workspace(),
      note(
        'p_connection_id',
        'uuid',
        'The connection, from `pipeline_connections`.',
      ),
    ],
    result: 'void',
    assistant: card('sheetbase.pipeline_connection.remove'),
  },
])
