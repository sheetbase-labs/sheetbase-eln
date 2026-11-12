/**
 * The lakehouse SQL switch: whether pipeline steps may read the open tables
 * with SQL. A data steward turns it on, like the open tables themselves.
 *
 * Remote job connections are connectors (`register_connector` with
 * `adapter: "hpc"` in its settings); their token is a sealed secret that only
 * the app sets, so a token cannot read or write it. The jobs a run sent are on
 * `pipeline_remote_jobs`.
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
  ...note('p_workspace_id', 'uuid', 'Your workspace id.'),
  server: 'workspace',
})

const DOCS = 'pipeline-remote-api.md'

export const PIPELINE_REMOTE_OPERATIONS = defineOperations([
  {
    name: 'pipeline_lakehouse_settings',
    label: 'Check whether pipelines can read open tables',
    summary: 'Whether pipeline steps may run SQL over the open tables',
    description:
      'Whether a data steward has let pipeline steps run read-only SQL over the open tables, whether the open tables are on, and how many are ready to read. Returns `{ enabled, lakeEnabled, tableCount }`.',
    kind: 'read',
    inputs: [workspace()],
    result: 'json',
    assistant: {
      tool: 'sheetbase.pipeline_remote.read',
      presentation: 'answer',
      vocabulary: 'read',
    },
    docsPage: DOCS,
  },
  {
    name: 'set_pipeline_lakehouse_sql',
    label: 'Allow or stop SQL over open tables in pipelines',
    summary: 'Turn lakehouse SQL steps on or off',
    description:
      'Lets pipeline steps run read-only SQL over the open tables, or stops them. Needs data access (a data steward). Steps already saved stay as they are and fail with a plain reason while it is off. Returns `{ enabled, lakeEnabled, tableCount }`. Sends `pipeline.lakehouse_sql.updated`.',
    kind: 'write',
    inputs: [workspace(), note('p_enabled', 'bool', 'On or off.')],
    result: 'json',
    assistant: {
      tool: 'sheetbase.pipeline_remote.lakehouse_sql',
      presentation: 'card',
      vocabulary: 'propose',
    },
    docsPage: DOCS,
  },
])
