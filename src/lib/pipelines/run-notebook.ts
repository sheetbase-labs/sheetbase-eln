import type { DataClient } from '#/lib/data-client'
import { fetchRecord, formatNotebookDateTime } from '#/lib/notebook-data'
import { insertBlock } from '#/lib/notebook-mutations'
import type { RichTextPayload } from '#/lib/blocks/rich-text'
import type { PipelineRunWire } from './types'

/** A stretch of citation text, a link when it has an `href`. */
export interface CitationSegment {
  text: string
  href?: string
}

/** One paragraph of a citation. */
export type CitationParagraph = CitationSegment[]

/** An input a run was pinned to, with the names a reader recognises. */
export interface CitedInput {
  name: string
  datasetVersionId: string
  datasetId?: string
  /** "DS-0001 · Readings". */
  datasetName?: string
  versionLabel?: string
}

/** A dataset a run kept a version in. */
export interface CitedOutput {
  label: string
  datasetVersionId: string
  datasetId?: string
  datasetName?: string
}

const link = (text: string, href: string): CitationSegment => ({ text, href })
const plain = (text: string): CitationSegment => ({ text })
const snapshotsPath = (datasetId: string) => `/datasets/${datasetId}/snapshots`
const shortId = (id: string) => id.slice(0, 8)

/**
 * What a notebook says about a pipeline run it cites. It names the pipeline and
 * version, when the run started and how it ended, the datasets it read and the
 * ones it kept, each as a link to the thing itself, so a reader of the signed
 * notebook can follow it to the exact run. It is a plain statement: the
 * notebook's own signing covers it like any other block.
 */
export function runCitation(
  run: Pick<PipelineRunWire, 'id' | 'status' | 'started_at'>,
  options: {
    pipeline: { id: string; name: string }
    versionNumber: number | null
    inputs: CitedInput[]
    outputs: CitedOutput[]
  },
): CitationParagraph[] {
  const { pipeline } = options
  const version =
    options.versionNumber === null ? '' : ` v${String(options.versionNumber)}`
  const started = formatNotebookDateTime(run.started_at, { zone: true })
  const paragraphs: CitationParagraph[] = [
    [
      plain('Pipeline '),
      link(pipeline.name, `/pipelines/${pipeline.id}`),
      plain(`${version}, run of `),
      link(started, `/pipelines/${pipeline.id}/runs/${run.id}`),
      plain(`: ${run.status}.`),
    ],
  ]
  if (options.inputs.length > 0) {
    const segments: CitationSegment[] = [plain('Inputs: ')]
    options.inputs.forEach((input, index) => {
      if (index > 0) segments.push(plain('; '))
      segments.push(plain(`${input.name} = `))
      const name =
        input.datasetName ?? `dataset ${shortId(input.datasetVersionId)}`
      segments.push(
        input.datasetId
          ? link(name, snapshotsPath(input.datasetId))
          : plain(name),
      )
      if (input.versionLabel) segments.push(plain(` (${input.versionLabel})`))
    })
    segments.push(plain('.'))
    paragraphs.push(segments)
  }
  if (options.outputs.length > 0) {
    const segments: CitationSegment[] = [plain('Kept: ')]
    options.outputs.forEach((output, index) => {
      if (index > 0) segments.push(plain('; '))
      segments.push(plain(`“${output.label}” in `))
      const name =
        output.datasetName ?? `dataset ${shortId(output.datasetVersionId)}`
      segments.push(
        output.datasetId
          ? link(name, snapshotsPath(output.datasetId))
          : plain(name),
      )
    })
    segments.push(plain('.'))
    paragraphs.push(segments)
  }
  return paragraphs
}

export function runCitationPayload(
  paragraphs: CitationParagraph[],
): RichTextPayload {
  return {
    doc: {
      type: 'doc',
      content: paragraphs.map((segments) => ({
        type: 'paragraph' as const,
        content: segments.map(({ text, href }) => ({
          type: 'text' as const,
          text,
          ...(href
            ? { marks: [{ type: 'link' as const, attrs: { href } }] }
            : {}),
        })),
      })),
    },
  }
}

/** Insert the run's citation at the end of a notebook. */
export async function addRunToNotebook(
  client: DataClient,
  args: {
    recordId: string
    paragraphs: CitationParagraph[]
  },
): Promise<{ identifier: string | null }> {
  const record = await fetchRecord(client, args.recordId)
  await insertBlock(client, {
    recordId: args.recordId,
    type: 'rich_text',
    payload: runCitationPayload(args.paragraphs),
    expectedStructureVersion: record?.structureVersion,
  })
  return { identifier: record?.identifier ?? null }
}
