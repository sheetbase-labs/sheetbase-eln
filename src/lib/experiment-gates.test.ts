import { describe, expect, it } from 'vitest'

import {
  blocksBehindGates,
  evaluateGateCondition,
  gateRefusal,
  liveGate,
  nameList,
  normaliseGateReason,
  stepWaitsOnStep,
  toRecordGate,
} from './experiment-gates'
import type {
  GateBlockLike,
  GateContext,
  GateCondition,
  RecordGate,
} from './experiment-gates'

const table = (rows: unknown[][]): GateBlockLike => ({
  id: 'table-1',
  type: 'table',
  order: 10,
  partId: 'p1',
  payload: {
    title: 'Confluence check',
    columns: ['Well', 'Confluence (%)'],
    rows,
  },
})

const step = (
  id: string,
  order: number,
  completed: boolean,
  partId = 'p1',
): GateBlockLike => ({
  id,
  type: 'procedure_step',
  order,
  partId,
  payload: { text: `Step ${order}`, completed },
})

const ctx = (blocks: GateBlockLike[], done = false): GateContext => ({
  blocks,
  parts: [
    { id: 'p1', number: 1, title: 'Seed', state: done ? 'done' : 'now' },
    { id: 'p2', number: 2, title: 'Dose', state: 'later' },
  ],
})

describe('the page check of a gate condition', () => {
  const filled: GateCondition = {
    kind: 'table_filled',
    blockId: 'table-1',
    column: 'Confluence (%)',
  }

  it('names the rows that are missing a value, in the words the database uses', () => {
    const result = evaluateGateCondition(
      filled,
      ctx([
        table([
          ['A1', '80'],
          ['A2', ''],
          ['A3', null],
        ]),
      ]),
    )
    expect(result).toMatchObject({
      known: true,
      met: false,
      text: 'A2 and A3 have no Confluence (%)',
    })
  })

  it('is met when every row has the value, and asks for rows when there are none', () => {
    expect(
      evaluateGateCondition(filled, ctx([table([['A1', '80']])])).met,
    ).toBe(true)
    expect(evaluateGateCondition(filled, ctx([table([])]))).toMatchObject({
      met: false,
      text: 'Confluence check has no rows yet',
    })
  })

  it('counts rows when a number is asked for', () => {
    const result = evaluateGateCondition(
      { ...filled, minRows: 3 },
      ctx([
        table([
          ['A1', '80'],
          ['A2', ''],
        ]),
      ]),
    )
    expect(result.text).toBe(
      'Confluence check needs 3 rows with Confluence (%) (1 so far)',
    )
  })

  it('leaves a sheet and the sample count to the database', () => {
    const sheet: GateBlockLike = {
      id: 'table-1',
      type: 'sheet',
      order: 10,
      payload: {},
    }
    expect(evaluateGateCondition(filled, ctx([sheet])).known).toBe(false)
    expect(
      evaluateGateCondition({ kind: 'samples_linked', min: 3 }, ctx([])).known,
    ).toBe(false)
    // Quality control lives in the database; the page only shows its answer.
    expect(
      evaluateGateCondition({ kind: 'qc_in_control' }, ctx([])).known,
    ).toBe(false)
  })

  it('checks a step and a part', () => {
    const blocks = [step('s1', 1, false)]
    expect(
      evaluateGateCondition({ kind: 'step_done', blockId: 's1' }, ctx(blocks)),
    ).toMatchObject({ met: false, text: "Step 1 (Step 1) isn't done" })
    expect(
      evaluateGateCondition(
        { kind: 'part_done', partId: 'p1' },
        ctx(blocks, true),
      ).met,
    ).toBe(true)
  })

  it('finds a step by the step it was copied from', () => {
    const copied = {
      ...step('s9', 1, true),
      payload: { text: 'x', completed: true, sourceStepBlockId: 'template-s' },
    }
    expect(
      evaluateGateCondition(
        { kind: 'step_done', blockId: 'template-s' },
        ctx([copied]),
      ).met,
    ).toBe(true)
  })

  it('only warns about a date, and never blocks on it', () => {
    const early = evaluateGateCondition(
      { kind: 'date_reached', date: '2026-12-01' },
      ctx([]),
      new Date('2026-11-07T10:00:00Z'),
    )
    expect(early).toMatchObject({
      met: false,
      soft: true,
      text: 'Not before 1 Dec 2026',
    })
    expect(
      evaluateGateCondition(
        { kind: 'date_reached', date: '2026-11-07' },
        ctx([]),
        new Date('2026-11-07T10:00:00Z'),
      ).met,
    ).toBe(true)
  })
})

function gate(extra: Partial<RecordGate> = {}): RecordGate {
  return {
    gateId: 'block:g1',
    kind: 'block',
    blockId: 'g1',
    partId: null,
    partNumber: null,
    label: 'Check',
    mode: 'block',
    met: false,
    blocking: true,
    overridden: false,
    overriddenAt: null,
    overriddenByUserId: null,
    overrideReason: null,
    missing: ['server says missing'],
    conditions: [
      { kind: 'step_done', met: false, soft: false, text: 'server text' },
    ],
    fromTemplate: false,
    ...extra,
  }
}

describe('a gate as the page shows it', () => {
  it('answers before the database is asked again', () => {
    const live = liveGate(
      gate(),
      [{ kind: 'step_done', blockId: 's1' }],
      ctx([step('s1', 1, true)]),
    )
    expect(live.met).toBe(true)
    expect(live.blocking).toBe(false)
    expect(live.missing).toEqual([])
  })

  it('keeps the database answer for what the page cannot check', () => {
    const live = liveGate(
      gate({
        conditions: [
          { kind: 'samples_linked', met: false, soft: false, text: 'few' },
        ],
      }),
      [{ kind: 'samples_linked', min: 3 }],
      ctx([]),
    )
    expect(live.met).toBe(false)
    expect(live.missing).toEqual(['few'])
  })

  it('does not block on a date alone', () => {
    const live = liveGate(
      gate({
        conditions: [
          { kind: 'date_reached', met: false, soft: true, text: 'later' },
        ],
      }),
      [{ kind: 'date_reached', date: '2099-01-01' }],
      ctx([]),
    )
    expect(live.met).toBe(false)
    expect(live.blocking).toBe(false)
  })
})

describe('what a closed gate holds back', () => {
  const blocks: GateBlockLike[] = [
    { id: 'a', type: 'rich_text', order: 1, partId: 'p1', payload: {} },
    { id: 'g1', type: 'gate', order: 2, partId: 'p1', payload: {} },
    { id: 'b', type: 'rich_text', order: 3, partId: 'p1', payload: {} },
    { id: 'c', type: 'rich_text', order: 4, partId: 'p2', payload: {} },
  ]

  it('holds back what follows a gate block in its own part, not what is before it', () => {
    const held = blocksBehindGates(blocks, [gate()])
    expect([...held.keys()]).toEqual(['b'])
  })

  it('holds back a whole part behind its rule', () => {
    const held = blocksBehindGates(blocks, [
      gate({ gateId: 'part:p2', kind: 'part', blockId: null, partId: 'p2' }),
    ])
    expect([...held.keys()]).toEqual(['c'])
  })

  it('holds back nothing once the gate is open or gone past', () => {
    expect(blocksBehindGates(blocks, [gate({ met: true })]).size).toBe(0)
    expect(blocksBehindGates(blocks, [gate({ overridden: true })]).size).toBe(0)
  })

  it('makes steps wait on the first one not done when a part is in order', () => {
    const steps = [
      step('s1', 1, true),
      step('s2', 2, false),
      step('s3', 3, false),
      step('s4', 4, false),
    ]
    const waits = stepWaitsOnStep(steps, new Set(['p1']))
    expect([...waits.entries()]).toEqual([
      ['s3', 2],
      ['s4', 2],
    ])
    expect(stepWaitsOnStep(steps, new Set()).size).toBe(0)
  })
})

describe('words and refusals', () => {
  it('lists names the way the database does', () => {
    expect(nameList(['A'])).toBe('A')
    expect(nameList(['A', 'B'])).toBe('A and B')
    expect(nameList(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C and 2 more')
  })

  it('needs a reason, trimmed, of a sensible length', () => {
    expect(normaliseGateReason('   ')).toBeNull()
    expect(normaliseGateReason('  later  ')).toBe('later')
    expect(normaliseGateReason('x'.repeat(2001))).toBeNull()
  })

  it('tells a refusal from a gate from any other failure', () => {
    expect(gateRefusal({ code: 'SB150', message: 'x' })?.code).toBe('SB150')
    expect(
      gateRefusal({
        code: 'validation_error',
        message: 'Part 2 is not open yet: At least 20 samples',
      })?.code,
    ).toBe('SB150')
    expect(
      gateRefusal({ code: 'validation_error', message: 'Something else' }),
    ).toBeNull()
  })

  it('reads a gate from the database, with nothing missing when none is sent', () => {
    expect(
      toRecordGate({
        gate_id: 'part:p1',
        gate_kind: 'part',
        block_id: null,
        part_id: 'p1',
        part_number: 1,
        label: 'Part 1',
        mode: 'warn',
        met: true,
        blocking: false,
        overridden: false,
        overridden_at: null,
        overridden_by_user_id: null,
        override_reason: null,
        from_template: false,
      }),
    ).toMatchObject({ missing: [], conditions: [], partNumber: 1 })
  })
})
