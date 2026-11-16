/**
 * Put a saved analysis into an experiment's notebook as a live block. The
 * Analysis Studio's "Save and add to <experiment>" runs this same function, so
 * a person, a token, an agent and a pipeline all place a result the same way.
 */
import { defineOperations, input } from '#/lib/operations/descriptor'
import type { OperationInput } from '#/lib/operations/descriptor'

const note = (field: OperationInput, description: string): OperationInput => ({
  ...field,
  description,
})

export const RESULTS_ANALYSIS_OPERATIONS = defineOperations([
  {
    name: 'add_analysis_to_notebook',
    label: 'Add an analysis to a notebook',
    summary: 'Add a saved analysis to a notebook',
    description:
      'Puts a saved analysis into an experiment’s notebook as a live block: the notebook shows its numbers and plot and keeps them current as the analysis or its data change, and the experiment’s Results tab lists it. Adding the same analysis to the same notebook again returns the block that is already there. Returns the block and `already_there`. Sends `analysis.added_to_notebook`.',
    kind: 'write',
    inputs: [
      note(
        input('p_record_id', 'uuid'),
        'The experiment (`records.id`) whose notebook gets the analysis.',
      ),
      note(
        input('p_definition_id', 'uuid'),
        'The saved analysis (`analysis_definitions.id`).',
      ),
      note(
        input('p_title', 'text', false, true),
        'The block’s title. The analysis’s name if left out.',
      ),
    ],
    result: 'json',
    assistant: { tool: 'sheetbase.analysis.add_saved_to_notebook' },
    pipeline: {},
    docsPage: 'results-analysis-api.md',
    events: [
      {
        name: 'analysis.added_to_notebook',
        family: 'record',
        summary: 'A saved analysis was added to a notebook as a block.',
        producer: { entityType: 'analysis_notebook', operation: 'create' },
        notes:
          'Payload carries `recordId`, `definitionId`, `analysis` (its name), `title` and `blockId`. It fires whenever an analysis block that names a saved analysis is added to a notebook: from this action, the block editor, “Cite in a notebook” or a plain block insert. It does not fire when the analysis was already there.',
      },
    ],
  },
])
