import assert from 'node:assert/strict'
import { describe, expect, it } from 'vitest'

import {
  buildRunEvent,
  columnLineageFor,
  eventTypeForRunStatus,
  lineageIntent,
} from './openlineage'

describe('openlineage', () => {
  const input = {
    datasetId: 'in',
    name: 'In',
    versionId: 'v1',
    columns: ['batch', 'titre'],
  }

  const output = {
    datasetId: 'out',
    name: 'Out',
    versionId: 'v2',
    columns: ['batch', 'scaled'],
  }

  it('builds a RunEvent with dataset versions and column lineage', () => {
    const event = buildRunEvent(
      {
        eventType: 'COMPLETE',
        eventTime: '2026-11-07T00:00:00Z',
        runId: 'run-1',
        jobName: 'pipeline.scale',
        jobType: 'PIPELINE',
        inputs: [input],
        outputs: [output],
      },
      'lab',
      '1.0',
    )

    expect(event.run.runId).toBe('run-1')
    expect(event.inputs[0].facets.version).toMatchObject({
      datasetVersion: 'v1',
    })

    const lineage = event.outputs[0].facets.columnLineage
    assert.ok(lineage)

    expect(Object.keys(lineage.fields)).toEqual(['batch'])
    expect(event.schemaURL).toContain('RunEvent')
  })

  it('has no column lineage when nothing matches', () => {
    expect(
      columnLineageFor('lab', [input], { ...output, columns: ['x'] }),
    ).toBeNull()
  })

  it('reads all matching columns before dataset identities, retaining native failures', () => {
    const reads: string[] = []
    let firstId = 'before'
    let fail = false

    const inputs = [
      {
        name: 'First',
        get columns() {
          reads.push('first.columns')

          return ['titre']
        },
        get datasetId() {
          reads.push('first.id')

          return firstId
        },
      },
      {
        name: 'Second',
        get columns() {
          reads.push('second.columns')

          if (fail) throw new RangeError('columns unavailable')
          firstId = 'after'

          return ['TITRE']
        },
        get datasetId() {
          reads.push('second.id')

          return 'second'
        },
      },
    ]

    const lineage = columnLineageFor('lab', inputs, {
      ...output,
      columns: ['TiTrE'],
    })

    expect(lineage?.fields.TiTrE.inputFields).toEqual([
      { namespace: 'lab', name: 'datasets/after', field: 'TiTrE' },
      { namespace: 'lab', name: 'datasets/second', field: 'TiTrE' },
    ])
    expect(reads).toEqual([
      'first.columns',
      'second.columns',
      'first.id',
      'second.id',
    ])
    reads.length = 0
    fail = true
    expect(() =>
      columnLineageFor('lab', inputs, { ...output, columns: ['TiTrE'] }),
    ).toThrow('columns unavailable')
    expect(reads).toEqual(['first.columns', 'second.columns'])
  })

  it('maps change events to lineage intents', () => {
    expect(
      lineageIntent({
        entityType: 'pipeline_run',
        operation: 'create',
        payload: {},
      }),
    ).toMatchObject({ eventType: 'START' })
    expect(
      lineageIntent({
        entityType: 'dataset_import',
        operation: 'update',
        payload: { status: 'failed' },
      }),
    ).toMatchObject({ eventType: 'FAIL' })
    expect(
      lineageIntent({ entityType: 'folder', operation: 'create', payload: {} }),
    ).toBeNull()
    expect(eventTypeForRunStatus('cancelled')).toBe('ABORT')
    expect(eventTypeForRunStatus('running')).toBeNull()
  })
})
