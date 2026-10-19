import type { DataClient } from '#/lib/data-client'
import { fetchRecord } from '#/lib/notebook-data'
import { insertBlock } from '#/lib/notebook-mutations'
import type { RichTextPayload } from '#/lib/blocks/rich-text'
import type { PipelineRunOutputWire, PipelineRunWire } from './types'

/**
 * What a notebook says about a pipeline run it cites. The text names the run,
 * the pipeline version, how it ended and the dataset snapshots it kept, so a
 * reader of the signed notebook can find the exact run later. It is a plain
 * statement: the notebook's own signing covers it like any other block.
 */
export function runCitationLines(
  run: Pick<PipelineRunWire, 'id' | 'status' | 'started_at' | 'input_versions'>,
  options: {
    pipelineKey: string
    versionNumber: number | null
    outputs: Pick<PipelineRunOutputWire, 'label' | 'dataset_version_id'>[]
  },
): string[] {
  const version =
    options.versionNumber === null ? '' : ` v${String(options.versionNumber)}`
  const lines = [
    `Pipeline run ${run.id.slice(0, 8)} of ${options.pipelineKey}${version} ${run.status}, started ${run.started_at.slice(0, 16).replace('T', ' ')}.`,
  ]
  const inputs = Object.entries(run.input_versions)
  if (inputs.length > 0) {
    lines.push(
      `Inputs: ${inputs.map(([name, id]) => `${name} (${id.slice(0, 8)})`).join(', ')}.`,
    )
  }
  if (options.outputs.length > 0) {
    lines.push(
      `Kept: ${options.outputs.map((o) => `${o.label} (snapshot ${o.dataset_version_id.slice(0, 8)})`).join(', ')}.`,
    )
  }
  return lines
}

export function runCitationPayload(lines: string[]): RichTextPayload {
  return {
    doc: {
      type: 'doc',
      content: lines.map((text) => ({
        type: 'paragraph',
        content: [{ type: 'text', text }],
      })),
    },
  }
}

/** Insert the run's citation at the end of a notebook. */
export async function addRunToNotebook(
  client: DataClient,
  args: {
    recordId: string
    lines: string[]
  },
): Promise<{ identifier: string | null }> {
  const record = await fetchRecord(client, args.recordId)
  await insertBlock(client, {
    recordId: args.recordId,
    type: 'rich_text',
    payload: runCitationPayload(args.lines),
    expectedStructureVersion: record?.structureVersion,
  })
  return { identifier: record?.identifier ?? null }
}
