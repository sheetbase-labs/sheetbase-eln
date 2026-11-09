import { describe, expect, it } from 'vitest'

import {
  parsePipelineDraftAnswer,
  pipelineDraftInstruction,
} from './ai-pipeline-draft'
import type { PipelineDraftContext } from './ai-pipeline-draft'

const context: PipelineDraftContext = {
  schemas: [
    {
      definitionId: '00000000-0000-4000-8000-0000000000b1',
      versionId: '00000000-0000-4000-8000-0000000000a1',
      name: 'Plate reader',
      fields: [
        { key: 'well', type: 'text' },
        { key: 'od600', type: 'decimal' },
      ],
    },
    {
      definitionId: '00000000-0000-4000-8000-0000000000b2',
      versionId: '00000000-0000-4000-8000-0000000000a2',
      name: 'Hits',
      fields: [{ key: 'well', type: 'text' }],
    },
  ],
  datasets: [
    {
      id: '00000000-0000-4000-8000-0000000000c1',
      name: 'Hit list',
      schemaVersionId: '00000000-0000-4000-8000-0000000000a2',
    },
  ],
}

const good = {
  summary: 'Keep wells above a cut-off.',
  inputs: [{ name: 'Plate Results', schema: 's1' }],
  parameters: [{ name: 'cutoff', type: 'decimal', default: 0.5 }],
  steps: [
    {
      name: 'keep',
      sql: 'select well from plate_results where od600 > {{cutoff}};',
    },
  ],
  output: { mode: 'create', schema: 's2', datasetName: 'Hits', label: 'Run' },
}

describe('pipelineDraftInstruction', () => {
  it('lists schemas and datasets by short key, never by id', () => {
    const text = pipelineDraftInstruction('keep hits', context)
    expect(text).toContain(
      's1 | Plate reader | columns: well (text), od600 (decimal)',
    )
    expect(text).toContain('d1 | Hit list | s2')
    expect(text).not.toContain('00000000-0000-4000-8000-0000000000b1')
  })

  it('includes the current steps so a follow-up revises them', () => {
    const text = pipelineDraftInstruction('add a sort', context, {
      statement: 'select 1 as x',
      inputs: [],
    })

    expect(text).toContain('Step 1: select 1 as x')
  })
})

describe('parsePipelineDraftAnswer', () => {
  it('turns a good answer into a checked draft', () => {
    const out = parsePipelineDraftAnswer(JSON.stringify(good), context)
    expect(out?.config.inputs).toEqual([
      {
        name: 'plate_results',
        required: true,
        schemaId: '00000000-0000-4000-8000-0000000000b1',
      },
    ])
    expect(out?.config.parameters[0]).toMatchObject({
      name: 'cutoff',
      default: 0.5,
      required: false,
    })
    expect(out?.config.transform.statement).toBe(
      'select well from plate_results where od600 > {{cutoff}}',
    )
    expect(out?.config.output).toMatchObject({
      mode: 'create',
      schemaVersionId: '00000000-0000-4000-8000-0000000000a2',
      datasetName: 'Hits',
    })
    expect(out?.skipped).toEqual([])
  })

  it('keeps later steps and appends to a real dataset', () => {
    const out = parsePipelineDraftAnswer(
      JSON.stringify({
        ...good,
        parameters: [],
        steps: [
          { sql: 'select 1 as well' },
          { name: 'more', sql: 'select * from previous' },
        ],
        output: { mode: 'append', dataset: 'd1' },
      }),
      context,
    )

    expect(out?.config.steps).toEqual([
      { name: 'more', language: 'sql', statement: 'select * from previous' },
    ])
    expect(out?.config.output).toMatchObject({
      mode: 'append',
      datasetId: '00000000-0000-4000-8000-0000000000c1',
    })
  })

  it('falls back to preview only when the output target is unknown', () => {
    const out = parsePipelineDraftAnswer(
      JSON.stringify({
        ...good,
        output: { mode: 'append', dataset: 'd9' },
      }),
      context,
    )

    expect(out?.config.output.mode).toBe('none')
    expect(out?.skipped).toContain('where to save the result')
  })

  it('refuses a draft with no SQL, an undeclared placeholder, or no JSON', () => {
    expect(
      parsePipelineDraftAnswer(JSON.stringify({ ...good, steps: [] }), context),
    ).toBeNull()
    expect(
      parsePipelineDraftAnswer(
        JSON.stringify({ ...good, parameters: [] }),
        context,
      ),
    ).toBeNull()
    expect(parsePipelineDraftAnswer('sorry, no', context)).toBeNull()
  })

  it('drops reserved and duplicate names', () => {
    const out = parsePipelineDraftAnswer(
      JSON.stringify({
        ...good,
        inputs: [{ name: 'previous' }, { name: 'a' }, { name: 'a' }],
      }),
      context,
    )

    expect(out?.config.inputs.map((i) => i.name)).toEqual(['a'])
    expect(out?.skipped).toHaveLength(2)
  })
})
