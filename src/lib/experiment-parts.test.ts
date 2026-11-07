import { describe, expect, it } from 'vitest'

import {
  blocksOfPart,
  currentPart,
  daysSinceStart,
  formatPartDate,
  lastDayOffset,
  partDate,
  partIsDue,
  partNumberFromParam,
  partsProgress,
  shownPart,
  splitPointsAtHeadings,
} from './experiment-parts'
import type { ExperimentPart } from './experiment-parts'

const part = (
  id: string,
  position: number,
  extra: Partial<ExperimentPart> = {},
): ExperimentPart => ({
  id,
  recordId: 'rec',
  position,
  title: `Part ${id}`,
  dayOffset: position - 1,
  assigneeUserId: null,
  openedAt: null,
  completedAt: null,
  completedByUserId: null,
  requiresSignOff: false,
  signedOffAt: null,
  signedOffByUserId: null,
  signoffId: null,
  ...extra,
})

const step = (id: string, partId: string, completed: boolean) => ({
  id,
  type: 'procedure_step',
  partId,
  payload: { completed },
})

describe('partsProgress', () => {
  it('is done when its steps are, and the first part not done is now', () => {
    const progress = partsProgress(
      [part('a', 1), part('b', 2), part('c', 3)],
      [
        step('s1', 'a', true),
        step('s2', 'a', true),
        step('s3', 'b', true),
        step('s4', 'b', false),
        step('s5', 'c', false),
      ],
    )
    expect(progress.map((p) => [p.number, p.state])).toEqual([
      [1, 'done'],
      [2, 'now'],
      [3, 'later'],
    ])
    expect(progress[1]).toMatchObject({ stepCount: 2, stepsDone: 1 })
  })

  it('takes a part without steps as done only when it was marked', () => {
    const progress = partsProgress(
      [part('a', 1, { completedAt: '2026-11-06T09:00:00Z' }), part('b', 2)],
      [{ id: 't', type: 'rich_text', partId: 'b', payload: {} }],
    )
    expect(progress.map((p) => p.state)).toEqual(['done', 'now'])
    expect(progress[1].blockCount).toBe(1)
  })

  it('orders by position, and a part with steps ignores a stale mark', () => {
    const progress = partsProgress(
      [part('b', 2), part('a', 1, { completedAt: '2026-11-06T09:00:00Z' })],
      [step('s1', 'a', false)],
    )
    expect(progress.map((p) => p.id)).toEqual(['a', 'b'])
    expect(progress[0].state).toBe('now')
  })

  it('has no current part once every part is done', () => {
    const progress = partsProgress(
      [part('a', 1, { completedAt: '2026-11-06T09:00:00Z' })],
      [],
    )
    expect(currentPart(progress)).toBeNull()
    expect(shownPart(progress, null)?.id).toBe('a')
  })
})

describe('a part that needs a signature', () => {
  it('stays the part to work on until it is signed, and the next waits', () => {
    const blocks = [
      step('s1', 'a', true),
      step('s2', 'a', true),
      step('s3', 'b', false),
    ]
    const unsigned = partsProgress(
      [
        part('a', 1, { requiresSignOff: true }),
        part('b', 2, { requiresSignOff: true }),
      ],
      blocks,
    )
    expect(unsigned.map((p) => [p.state, p.awaitingSignOff, p.signed])).toEqual(
      [
        ['now', true, false],
        ['later', false, false],
      ],
    )
    expect(currentPart(unsigned)?.number).toBe(1)

    const signed = partsProgress(
      [
        part('a', 1, {
          requiresSignOff: true,
          signedOffAt: '2026-11-03T10:00:00Z',
          signoffId: 'sig',
        }),
        part('b', 2, { requiresSignOff: true }),
      ],
      blocks,
    )
    expect(signed.map((p) => [p.state, p.awaitingSignOff, p.signed])).toEqual([
      ['done', false, true],
      ['now', false, false],
    ])
  })

  it('is not awaiting while its steps are still open, and a part that needs none is done with its steps', () => {
    const blocks = [
      step('s1', 'a', true),
      step('s2', 'a', false),
      step('s3', 'b', false),
    ]
    const progress = partsProgress(
      [part('a', 1, { requiresSignOff: true }), part('b', 2)],
      blocks,
    )
    expect(progress[0]).toMatchObject({ state: 'now', awaitingSignOff: false })
    expect(progress[1]).toMatchObject({
      state: 'later',
      awaitingSignOff: false,
    })
    const free = partsProgress([part('a', 1)], [step('s1', 'a', true)])
    expect(free[0]).toMatchObject({ state: 'done', awaitingSignOff: false })
  })

  it('treats a part without steps as awaiting once it was marked done', () => {
    const progress = partsProgress(
      [
        part('a', 1, {
          requiresSignOff: true,
          completedAt: '2026-11-03T10:00:00Z',
        }),
      ],
      [],
    )
    expect(progress[0]).toMatchObject({ state: 'now', awaitingSignOff: true })
  })
})

describe('shownPart', () => {
  const progress = partsProgress([part('a', 1), part('b', 2)], [])

  it('shows the one in the URL, else the current one', () => {
    expect(shownPart(progress, 2)?.id).toBe('b')
    expect(shownPart(progress, null)?.id).toBe('a')
    expect(shownPart(progress, 9)?.id).toBe('a')
    expect(shownPart([], 1)).toBeNull()
  })
})

describe('blocksOfPart and partNumberFromParam', () => {
  it('filters to the part, or keeps everything with no part', () => {
    const blocks = [
      { id: '1', partId: 'a' },
      { id: '2', partId: 'b' },
    ]
    expect(blocksOfPart(blocks, { id: 'b' })).toEqual([blocks[1]])
    expect(blocksOfPart(blocks, null)).toEqual(blocks)
  })

  it('reads a part number from the URL only when it is one', () => {
    expect(partNumberFromParam('3')).toBe(3)
    expect(partNumberFromParam('0')).toBeNull()
    expect(partNumberFromParam('x')).toBeNull()
    expect(partNumberFromParam('1000')).toBeNull()
    expect(partNumberFromParam(undefined)).toBeNull()
  })
})

describe('dates', () => {
  it('counts days from the day the experiment started, in UTC', () => {
    const started = '2026-11-02T23:30:00Z'
    expect(partDate(started, 3).toISOString().slice(0, 10)).toBe('2026-11-05')
    expect(formatPartDate(partDate(started, 0))).toBe('Mon 2 Nov')
    expect(daysSinceStart(started, new Date('2026-11-05T01:00:00Z'))).toBe(3)
    expect(daysSinceStart(started, new Date('2026-10-30T01:00:00Z'))).toBe(0)
  })

  it('is due on its day or after while it is not done', () => {
    const [first, second] = partsProgress([part('a', 1), part('b', 2)], [])
    const now = new Date('2026-11-03T10:00:00Z')
    expect(partIsDue(first, '2026-11-02T09:00:00Z', now)).toBe(true)
    expect(partIsDue(second, '2026-11-02T09:00:00Z', now)).toBe(true)
    expect(
      partIsDue({ ...second, dayOffset: 5 }, '2026-11-02T09:00:00Z', now),
    ).toBe(false)
    expect(
      partIsDue({ ...first, state: 'done' }, '2026-11-02T09:00:00Z', now),
    ).toBe(false)
  })

  it('knows the last day', () => {
    expect(lastDayOffset([])).toBeNull()
    expect(lastDayOffset([part('a', 1), part('b', 2, { dayOffset: 9 })])).toBe(
      9,
    )
  })
})

describe('splitPointsAtHeadings', () => {
  const heading = (id: string, order: number, text: string, level = 2) => ({
    id,
    type: 'rich_text',
    order,
    payload: {
      doc: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level },
            content: [{ type: 'text', text }],
          },
        ],
      },
    },
  })

  it('splits at each level-2 heading and not at others', () => {
    const points = splitPointsAtHeadings([
      heading('a', 1, 'Seed cells'),
      heading('b', 2, 'Notes', 3),
      heading('c', 3, 'Dose'),
    ])
    expect(points).toEqual([
      { title: 'Seed cells', firstBlockId: 'a' },
      { title: 'Dose', firstBlockId: 'c' },
    ])
  })
})
