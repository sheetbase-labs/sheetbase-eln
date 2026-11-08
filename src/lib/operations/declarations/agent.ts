/**
 * The draft vocabulary the gateway and the agent workflows share: what a model
 * or workflow may ask for, always as a draft or a proposal a person applies.
 */
import { defineOperations } from '../descriptor'

const operation = (tool: string) => ({
  tool,
  presentation: 'card' as const,
  vocabulary: 'operation' as const,
})

export const AGENT_OPERATIONS = defineOperations([
  {
    name: 'dataset_schema_draft',
    label: 'Draft a dataset schema',
    description:
      'Proposes the columns of a new dataset. A person reviews it before anything is created.',
    kind: 'write',
    inputs: [],
    assistant: operation('sheetbase.dataset_schema.draft'),
  },
  {
    name: 'sheet_definition_draft',
    label: 'Draft a sheet definition',
    description:
      'Proposes a new sheet: its columns and where its rows come from.',
    kind: 'write',
    inputs: [],
    assistant: operation('sheetbase.sheet_definition.draft'),
  },
  {
    name: 'sheet_definition_update_draft',
    label: 'Draft a change to a sheet definition',
    description: 'Proposes a change to an existing sheet definition.',
    kind: 'write',
    inputs: [],
    assistant: operation('sheetbase.sheet_definition.update_draft'),
  },
  {
    name: 'pipeline_definition_draft',
    label: 'Draft a pipeline',
    description: 'Proposes a new pipeline: its steps, actions and triggers.',
    kind: 'write',
    inputs: [],
    assistant: operation('sheetbase.pipeline_definition.draft'),
  },
  {
    name: 'pipeline_definition_version_draft',
    label: 'Draft a new pipeline version',
    description: 'Proposes a new version of an existing pipeline.',
    kind: 'write',
    inputs: [],
    assistant: operation('sheetbase.pipeline_definition.version_draft'),
  },
  {
    name: 'pipeline_definition_update_draft',
    label: 'Draft a change to a pipeline',
    description: 'Proposes a change to a pipeline that is still a draft.',
    kind: 'write',
    inputs: [],
    assistant: operation('sheetbase.pipeline_definition.update_draft'),
  },
  {
    name: 'dataset_rows_commit',
    label: 'Commit rows to a dataset',
    description:
      'Proposes a batch of validated rows for a dataset. A person approves the commit.',
    kind: 'write',
    inputs: [],
    assistant: operation('sheetbase.dataset_rows.commit'),
  },
])
