import { describe, expect, it } from 'vitest'

import { teamLayoutsFromRows } from './team-layouts'

const origin = 'http://localhost'

describe('teamLayoutsFromRows', () => {
  it('opens a shared layout under its row id and name', () => {
    const [layout] = teamLayoutsFromRows(
      [
        {
          id: 'row-1',
          name: 'Review desk',
          updated_at: '2026-10-26T09:00:00Z',
          layout: {
            panes: [{ id: 'a', href: '/experiments', title: 'Experiments' }],
            tree: { type: 'pane', id: 'a' },
            primaryId: 'a',
          },
        },
      ],
      origin,
    )
    expect(layout).toMatchObject({ id: 'row-1', name: 'Review desk' })
    expect(layout.panes).toHaveLength(1)
  })

  it('leaves out a layout it can no longer read', () => {
    expect(
      teamLayoutsFromRows(
        [
          {
            id: 'row-2',
            name: 'Broken',
            updated_at: '2026-10-26T09:00:00Z',
            layout: { panes: [], tree: null, primaryId: 'x' },
          },
        ],
        origin,
      ),
    ).toEqual([])
  })
})
