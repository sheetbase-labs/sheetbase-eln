import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  addRunToNotebook,
  runCitation,
  runCitationPayload,
} from './run-notebook'
import { createDataClient } from '#/lib/data-client'

const run = {
  id: '12345678-aaaa',
  status: 'succeeded' as const,
  started_at: '2026-10-19T09:30:11Z',
  input_versions: { readings: 'abcdef12-0000' },
}

describe('runCitation', () => {
  const pipeline = { id: 'def-1', name: 'QC daily' }

  it('links the pipeline, the run, the datasets read and the datasets kept', () => {
    const paragraphs = runCitation(run, {
      pipeline,
      versionNumber: 5,
      inputs: [
        {
          name: 'readings',
          datasetVersionId: 'abcdef12-0000',
          datasetId: 'ds-1',
          datasetName: 'DS-0001 · Readings',
          versionLabel: 'Weekly',
        },
      ],
      outputs: [
        {
          label: 'Summary',
          datasetVersionId: '99887766-bbbb',
          datasetId: 'ds-2',
          datasetName: 'DS-0002 · Summary',
        },
      ],
    })

    const text = paragraphs.map((p) => p.map((s) => s.text).join(''))
    expect(text[0]).toMatch(/^Pipeline QC daily v5, run of .*: succeeded\.$/)
    expect(text[1]).toBe('Inputs: readings = DS-0001 · Readings (Weekly).')
    expect(text[2]).toBe('Kept: “Summary” in DS-0002 · Summary.')
    const hrefs = paragraphs.flat().flatMap((s) => (s.href ? [s.href] : []))
    expect(hrefs).toEqual([
      '/pipelines/def-1',
      '/pipelines/def-1/runs/12345678-aaaa',
      '/datasets/ds-1/snapshots',
      '/datasets/ds-2/snapshots',
    ])
    // No bare ids in what a reader sees.
    expect(text.join(' ')).not.toMatch(/12345678|abcdef12|99887766/)
  })

  it('falls back to short ids when a dataset is not known, and leaves out what it lacks', () => {
    const paragraphs = runCitation(run, {
      pipeline,
      versionNumber: null,
      inputs: [],
      outputs: [],
    })

    expect(paragraphs).toHaveLength(1)

    const withUnknown = runCitation(run, {
      pipeline,
      versionNumber: null,
      inputs: [{ name: 'readings', datasetVersionId: 'abcdef12-0000' }],
      outputs: [],
    })

    expect(withUnknown[1].map((s) => s.text).join('')).toBe(
      'Inputs: readings = dataset abcdef12.',
    )
  })

  it('writes links as link marks a notebook block can hold', () => {
    const payload = runCitationPayload(
      runCitation(run, {
        pipeline,
        versionNumber: 1,
        inputs: [],
        outputs: [],
      }),
    )

    const first = payload.doc.content[0]

    if (first.type !== 'paragraph')
      throw new Error('Expected a citation paragraph')

    expect(first.content?.[1].marks).toEqual([
      { type: 'link', attrs: { href: '/pipelines/def-1' } },
    ])
  })
})

describe('addRunToNotebook', () => {
  it('inserts a rich text block at the notebook structure version', async () => {
    const writes: string[] = []

    const client = createDataClient(async (_input, init) => {
      if (init?.method === 'POST') {
        writes.push(z.string().parse(init.body))

        return Response.json({
          block: {
            id: 'block-1',
            record_id: 'rec-1',
            type: 'rich_text',
            payload: {},
            payload_schema_version: 1,
            order: 1,
            version: 1,
            created_at: run.started_at,
            updated_at: run.started_at,
          },
          structure_version: 8,
        })
      }

      return Response.json([
        {
          id: 'rec-1',
          workspace_id: 'ws-1',
          project_id: null,
          folder_id: null,
          kind: 'experiment',
          identifier: 'EXP-0001',
          title: 'Experiment',
          status: 'draft',
          tags: [],
          structure_version: 7,
          metadata_version: 1,
          created_at: run.started_at,
          updated_at: run.started_at,
          archived_at: null,
          deleted_at: null,
          created_by_user_id: 'user-1',
          updated_by_user_id: null,
          properties: {},
          locked_at: null,
          locked_by_revision_id: null,
        },
      ])
    })

    const result = await addRunToNotebook(client, {
      recordId: 'rec-1',
      paragraphs: [[{ text: 'One.' }], [{ text: 'Two.' }]],
    })

    expect(result.identifier).toBe('EXP-0001')
    expect(writes).toHaveLength(1)
    expect(JSON.parse(writes[0])).toMatchObject({
      p_record_id: 'rec-1',
      p_type: 'rich_text',
      p_expected_structure_version: 7,
      p_payload: runCitationPayload([[{ text: 'One.' }], [{ text: 'Two.' }]]),
    })
  })
})
