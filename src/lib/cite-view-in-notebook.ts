import { freezeChart } from './chart-data'
import {
  composeAnalysisDefinition,
  freezeAnalysisBlock,
} from './analysis-definitions-data'
import { recordAnalysisCitation } from './analysis-studio-data'
import type { AnalysisViewWire } from './analysis-studio-data'
import type { DataClient } from './data-client'
import { plainTextToRichText } from './blocks/plain-text'
import { fetchRecord } from './notebook-data'
import { insertBlock, insertSheetInstanceBlock } from './notebook-mutations'
import { writeGridToSheet } from './sheet-grid-write'

/**
 * Cites a saved analysis view in a notebook as a frozen figure, and records the
 * citation. A chart over one dataset becomes an analysis block pinned to the
 * Dataset Version it was drawn from; a chart over several datasets cannot be
 * pinned to one version, so it becomes a frozen chart block that pins each
 * source. Both the Analysis Studio and the experiment's Results tab call this,
 * so a figure reaches the notebook the same way from either.
 */
export async function citeViewInNotebook(
  client: DataClient,
  args: {
    view: AnalysisViewWire
    recordId: string
    caption: string
    afterBlockId?: string
  },
): Promise<{ blockId: string; identifier: string | null }> {
  const { view, recordId } = args
  const caption = args.caption.trim()
  const target = await fetchRecord(client, recordId)

  const place = {
    recordId,
    expectedStructureVersion: target?.structureVersion,
    afterBlockId: args.afterBlockId,
  }

  let blockId: string

  if (view.charts[0].datasets.length === 1) {
    const definition = await composeAnalysisDefinition(client, {
      chartViewId: view.id,
      name: caption,
    })

    const inserted = await insertBlock(client, {
      ...place,
      type: 'analysis',
      payload: { title: caption, definitionId: definition.id },
    })

    await freezeAnalysisBlock(client, {
      blockId: inserted.block.id,
      expectedVersion: inserted.block.version,
    })
    blockId = inserted.block.id
  } else {
    const inserted = await insertBlock(client, {
      ...place,
      type: 'chart',
      payload: { title: caption, spec: view.charts[0] },
    })

    await freezeChart(client, {
      blockId: inserted.block.id,
      expectedVersion: inserted.block.version,
    })
    blockId = inserted.block.id
  }

  await recordAnalysisCitation(client, recordId, view)

  return { blockId, identifier: target?.identifier ?? null }
}

/**
 * Puts a results summary into a notebook as a plain table under a heading, so
 * the numbers an experiment found read in the notebook (and in the signed
 * record) and are not only a chart or an id on another tab. The values are the
 * ones the Results tab showed when it was added.
 */
export async function addSummaryTableToNotebook(
  client: DataClient,
  args: {
    recordId: string
    heading: string
    columns: string[]
    rows: string[][]
    afterBlockId?: string
  },
): Promise<{ blockId: string }> {
  const target = await fetchRecord(client, args.recordId)

  const heading = await insertBlock(client, {
    recordId: args.recordId,
    type: 'rich_text',
    afterBlockId: args.afterBlockId,
    expectedStructureVersion: target?.structureVersion,
    payload: plainTextToRichText(`## ${args.heading}`),
  })

  const sheet = await insertSheetInstanceBlock(client, {
    recordId: args.recordId,
    afterBlockId: heading.block.id,
  })

  await writeGridToSheet(client, sheet.instanceId, {
    columns: args.columns,
    rows: args.rows,
  })

  return { blockId: sheet.block.id }
}
