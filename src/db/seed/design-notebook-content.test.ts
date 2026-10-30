import { describe, expect, it } from 'vitest'

import { validateBlock } from '#/lib/blocks'
import { buildNotebook } from './design-notebook-content'
import type { NotebookStatus } from './design-notebook-content'
import { KITS, NAMED_TOPICS } from './design-notebook-kits'

const STATUSES: NotebookStatus[] = [
  'draft',
  'planned',
  'in_progress',
  'on_hold',
  'in_review',
  'returned',
  'approved',
]

describe('demo notebook content', () => {
  it('writes only valid blocks for every kit, topic and status', () => {
    for (const [name, kit] of Object.entries(KITS)) {
      for (const topic of kit.topics) {
        for (const status of STATUSES) {
          const blocks = buildNotebook({
            identifier: `EXP-${name}`,
            status,
            topic,
            kit,
            firstOrder: 1,
          })
          for (const block of blocks) {
            const result = validateBlock({
              type: block.type,
              payload: block.payload,
            })
            expect(
              result.ok,
              `${name} ${topic.title} ${status} ${block.type}`,
            ).toBe(true)
          }
        }
      }
    }
  })

  it('is the same notebook every time', () => {
    const kit = KITS.aav9
    const input = {
      identifier: 'EXP-2001',
      status: 'approved' as const,
      topic: kit.topics[0],
      kit,
      firstOrder: 1,
    }
    expect(buildNotebook(input)).toEqual(buildNotebook(input))
  })

  it('ends finished work in a conclusion and open work without one', () => {
    const kit = KITS.cart
    const topic = kit.topics[0]
    const types = (status: NotebookStatus) =>
      buildNotebook({
        identifier: 'EXP-2201',
        status,
        topic,
        kit,
        firstOrder: 1,
      }).map((b) => b.type)
    expect(types('approved')).toContain('conclusion')
    expect(types('in_review')).toContain('conclusion')
    expect(types('in_progress')).not.toContain('conclusion')
    expect(types('draft')).not.toContain('table')
  })

  it('has a topic for every named experiment it covers', () => {
    expect(Object.keys(NAMED_TOPICS).length).toBeGreaterThan(20)
  })
})
