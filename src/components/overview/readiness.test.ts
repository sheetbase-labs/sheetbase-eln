import { describe, expect, it } from 'vitest'

import {
  blockIdByInstanceId,
  protocolStepProgress,
  readinessItems,
} from './readiness'
import type {
  ExperimentReadiness,
  ReadinessBlock,
  ReadinessCheckResult,
} from './readiness'

function check(
  evidence: ReadinessCheckResult['evidence'],
  overrides: Partial<ReadinessCheckResult> = {},
): ReadinessCheckResult {
  return {
    key: 'check',
    category: 'schema',
    label: 'Check',
    severity: 'blocking',
    status: 'fail',
    evidence,
    ...overrides,
  }
}

function readiness(results: ReadinessCheckResult[] = []): ExperimentReadiness {
  return {
    recordId: 'record-1',
    ready: false,
    openCommentThreads: [],
    emptyRequiredFields: [],
    validationErrors: [
      {
        revisionId: 'revision-1',
        checkDefinitionKey: 'definition',
        checkDefinitionVersion: 1,
        overallStatus: 'fail',
        blockingFailures: 1,
        warningFailures: 0,
        results,
        runAt: '2026-11-01',
      },
    ],
  }
}

describe('protocolStepProgress native evidence', () => {
  it('retains native number acceptance and stable ordering, excluding empty or non-text steps', () => {
    const blocks: ReadinessBlock[] = [
      { id: 'ignored', type: 'metric', payload: { text: 'not a step' } },
      { id: 'blank', type: 'procedure_step', payload: { text: ' ' } },
      {
        id: 'object',
        type: 'procedure_step',
        payload: {
          text: {
            trim() {
              throw new Error('do not coerce')
            },
          },
        },
      },
      ...[NaN, Infinity, -Infinity, 0].map((stepNumber, index) => ({
        id: `native-${index}`,
        type: 'procedure_step',
        payload: { text: ` Step ${index} `, stepNumber },
      })),
    ]

    const result = protocolStepProgress(blocks)
    expect(result.map((step) => step.blockId)).toEqual([
      'native-0',
      'native-2',
      'native-3',
      'native-1',
    ])
    expect(result[0].stepNumber).toBeNaN()
    expect(result[1].stepNumber).toBe(-Infinity)
    expect(result[3].stepNumber).toBe(Infinity)
    expect(result[2]).toMatchObject({
      text: 'Step 3',
      completed: false,
      note: null,
      partId: null,
    })
  })

  it('retains repeated accessor reads, including the third note value', () => {
    const reads: string[] = []
    let noteReads = 0

    const payload = {
      get text() {
        reads.push('text')

        return ' Step '
      },
      get stepNumber() {
        reads.push('stepNumber')

        return Infinity
      },
      get completed() {
        reads.push('completed')

        return true
      },
      get completedAt() {
        reads.push('completedAt')

        return 'date'
      },
      get completedByUserId() {
        reads.push('completedByUserId')

        return 'author'
      },
      get note() {
        reads.push('note')
        noteReads += 1

        return noteReads === 3 ? 'third value' : 'probe'
      },
      get sourceProtocolRevisionId() {
        reads.push('sourceProtocolRevisionId')

        return 'revision'
      },
      get sourceStepBlockId() {
        reads.push('sourceStepBlockId')

        return 'source'
      },
      get unrelated() {
        throw new Error('not read')
      },
    }

    expect(
      protocolStepProgress([
        { id: 'step', type: 'procedure_step', payload },
      ])[0],
    ).toMatchObject({ text: 'Step', stepNumber: Infinity, note: 'third value' })
    expect(reads).toEqual([
      'text',
      'text',
      'stepNumber',
      'stepNumber',
      'completed',
      'completedAt',
      'completedAt',
      'completedByUserId',
      'completedByUserId',
      'note',
      'note',
      'note',
      'sourceProtocolRevisionId',
      'sourceProtocolRevisionId',
      'sourceStepBlockId',
      'sourceStepBlockId',
    ])
  })

  it('propagates the original second-read exception without reading later fields', () => {
    let reads = 0
    const failure = new Error('second text read')

    const payload = {
      get text() {
        reads += 1

        if (reads === 2) throw failure

        return 'Step'
      },
      get stepNumber() {
        throw new Error('must not reach number')
      },
    }

    expect(() =>
      protocolStepProgress([{ id: 'step', type: 'procedure_step', payload }]),
    ).toThrow(failure)
    expect(reads).toBe(2)
  })
})

describe('readinessItems evidence resolution', () => {
  it('reads inherited native evidence and preserves column precedence without traversing unrelated fields', () => {
    const reads: string[] = []

    const column = Object.assign(new Date('2026-11-01'), {
      tableId: 'block-1',
      fieldName: 'Titre',
      logicalType: 'furlong',
    })

    const evidence: ReadinessCheckResult['evidence'] = {}
    Object.setPrototypeOf(evidence, {
      get invalidColumns() {
        reads.push('invalidColumns')

        return [column]
      },
      get unsupportedFormulas() {
        throw new Error('lower priority evidence')
      },
      get unrelated() {
        throw new Error('no whole-object traversal')
      },
    })

    expect(readinessItems(readiness([check(evidence)]), [])[0]).toMatchObject({
      blockId: 'block-1',
      detail: 'Column “Titre” has unsupported type furlong.',
      unresolvedReason: null,
    })
    expect(reads).toEqual(['invalidColumns'])
  })

  it('retains first-column refusal even if that entry is not a record', () => {
    const first = Object.assign([], {
      fieldName: 'array field',
      tableId: 'wrong',
    })

    const result = readinessItems(
      readiness([
        check({
          invalidColumns: [first],
          unsupportedFormulas: [{ id: 'later:formula' }],
        }),
      ]),
      [],
    )

    expect(result[0]).toMatchObject({
      blockId: null,
      detail: 'A sheet column has an unsupported type.',
      unresolvedReason: null,
    })
  })

  it('uses formula-family priority, native first-entry identity and reason/status fallback', () => {
    const formulas = [
      { id: 'sheet-a:formula-1', reason: '', status: 'unsupported' },
    ]

    Object.defineProperty(formulas, 1, {
      get() {
        throw new Error('later entries remain unread')
      },
    })

    const result = readinessItems(
      readiness([
        check({
          unsupportedFormulas: formulas,
          staleFormulas: [{ id: 'wrong:formula' }],
        }),
      ]),
      [],
    )

    expect(result[0]).toMatchObject({
      blockId: 'sheet-a',
      detail: 'Formula sheet-a:formula-1 (unsupported).',
      unresolvedReason: null,
    })
    expect(
      readinessItems(
        readiness([
          check({ missingResults: [{ id: ':no-block', reason: ' ' }] }),
        ]),
        [],
      )[0],
    ).toMatchObject({ blockId: null, detail: 'Formula :no-block ( ).' })
  })

  it('preserves native count values, getter/coercion order and object identity', () => {
    const events: string[] = []

    const count = {
      toString() {
        events.push('count coercion')

        return 'two'
      },
    }

    const minimum = {
      toString() {
        events.push('minimum coercion')

        return 'five'
      },
    }

    const evidence = {
      path: 'measurements',
      get count() {
        events.push('count getter')

        return count
      },
      get minCount() {
        events.push('minimum getter')

        return minimum
      },
    }

    expect(readinessItems(readiness([check(evidence)]), [])[0].detail).toBe(
      'Found two of five required at measurements.',
    )
    expect(events).toEqual([
      'count getter',
      'minimum getter',
      'count coercion',
      'minimum coercion',
    ])
    expect(
      readinessItems(
        readiness([
          check({ path: 'x', count: Symbol('count'), minCount: [1, 2] }),
        ]),
        [],
      )[0].detail,
    ).toBe('Found Symbol(count) of 1,2 required at x.')
    expect(
      readinessItems(readiness([check({ path: 'x', count: null })]), [])[0]
        .detail,
    ).toBe('Found 0 of 0 required at x.')
  })

  it('propagates native coercion failure before later coercions', () => {
    const failure = new Error('native String failure')
    let coercedMinimum = false

    const evidence = {
      path: 'measurements',
      count: {
        toString() {
          throw failure
        },
      },
      minCount: {
        toString() {
          coercedMinimum = true

          return '5'
        },
      },
    }

    expect(() => readinessItems(readiness([check(evidence)]), [])).toThrow(
      failure,
    )
    expect(coercedMinimum).toBe(false)
  })

  it('retains native missing-link text rather than filtering or coercing it to JSON', () => {
    expect(
      readinessItems(
        readiness([
          check({ missingLinkTypes: [Symbol('protocol'), 0, false, [1, 2]] }),
        ]),
        [],
      )[0],
    ).toMatchObject({
      blockId: null,
      detail: 'Missing required link: Symbol(protocol), 0, false, 1,2.',
      unresolvedReason:
        'The check is record-level; no cell location resolves it.',
    })
  })

  it('preserves stable severity order, filtered-result IDs and honest unresolved locations', () => {
    const value = readiness([
      check({}, { key: 'pass', status: 'pass' }),
      check({}, { key: 'info', severity: 'informational' }),
      check({}, { key: 'unknown', severity: 'future' }),
      check({}, { key: 'blocking' }),
    ])

    value.openCommentThreads.push({
      commentId: 'comment',
      authorUserId: 'u',
      body: ' why\n now? ',
      target: { instanceId: 'instance' },
      createdAt: '2026-11-01',
    })
    value.emptyRequiredFields.push({
      instanceId: 'absent',
      instanceName: 'Missing sheet',
      parameterId: 'p',
      parameterKey: 'key',
      label: '',
    })

    const blocks = [
      { id: 'old', payload: { instanceId: 'instance' } },
      { id: 'new', payload: { instanceId: 'instance' } },
    ]

    expect(blockIdByInstanceId(blocks).get('instance')).toBe('new')
    const items = readinessItems(value, blocks, () => 'Scientist')
    expect(items.map((item) => item.id)).toEqual([
      'validation:definition:0:blocking:2',
      'required-field:absent:p:0',
      'validation:definition:0:unknown:1',
      'comment:comment:0',
      'validation:definition:0:info:0',
    ])
    expect(items[3]).toMatchObject({
      blockId: 'new',
      detail: 'Scientist: why now?',
      unresolvedReason: null,
    })
    expect(items[1]).toMatchObject({
      blockId: null,
      title: 'key is empty',
      unresolvedReason:
        "Sheet instance Missing sheet (absent) is not in this record's document.",
    })
  })
})
