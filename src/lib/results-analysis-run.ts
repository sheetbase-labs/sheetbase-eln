import { addAnalysisToNotebook, notebookBlockHref } from './analysis-notebook'
import { requestCodeCellRun } from './code-cells/code-cell'
import { plainTextToRichText } from './blocks/plain-text'
import type { DataClient } from './data-client'
import { insertBlock } from './notebook-mutations'
import { ANALYSIS_INPUT_ALIAS } from './results-analysis'
import type { AnalysisAction, AnalysisActionResult } from './results-analysis'
import { experimentPath } from './navigation'

/**
 * Runs an analysis card's action as the person who pressed the button. The
 * code cell is run first so a failure leaves the notebook alone; then the cell
 * is added with its output, and the draft summary after it.
 */
export async function runAnalysisAction(
  client: DataClient,
  action: AnalysisAction,
): Promise<AnalysisActionResult> {
  if (action.kind === 'analysis.add_saved') {
    const added = await addAnalysisToNotebook(client, {
      recordId: action.recordId,
      definitionId: action.definitionId,
      title: action.title,
    })

    return { openHref: notebookBlockHref(action.recordId, added.blockId) }
  }

  const inputs = [
    {
      alias: ANALYSIS_INPUT_ALIAS,
      datasetVersionId: action.datasetVersionId,
      label: action.versionLabel,
    },
  ]

  const output = await requestCodeCellRun({
    action: 'run',
    recordId: action.recordId,
    blockId: null,
    language: 'python',
    source: action.source,
    inputs: inputs.map(({ alias, datasetVersionId }) => ({
      alias,
      datasetVersionId,
    })),
  })

  if (output.status === 'error')
    throw new Error(output.errorMessage ?? 'The analysis did not run.')

  const cell = await insertBlock(client, {
    recordId: action.recordId,
    type: 'code_cell',
    payload: { language: 'python', source: action.source, inputs, output },
  })

  await insertBlock(client, {
    recordId: action.recordId,
    type: 'rich_text',
    afterBlockId: cell.block.id,
    payload: plainTextToRichText(
      `## ${action.heading} (draft)\n\nDrafted by the assistant from ${output.reference}. Check it against the figures and edit it before you sign.\n\n${action.draftSummary}`,
    ),
  })

  return { openHref: experimentPath(action.recordId) }
}
