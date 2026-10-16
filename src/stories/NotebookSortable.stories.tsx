import * as React from 'react'

import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  NotebookBlockHandle,
  NotebookBlockList,
  NotebookBlockRow,
  moveTargetIndex,
} from '#/components/notebook/notebook-block-reorder'

/**
 * The notebook's reorderable block list: the list that binds a drop to the
 * notebook's move contract, the row's own semantics, and the grip handle.
 *
 * The grip is hover-revealed — and only where a hover exists: the reveal is
 * gated on the pointer (`pointer-fine`), so a mouse sees it appear over the row
 * or on focus, while a touchscreen, which cannot hover and has no other route
 * to a reorder, simply sees it. That is also why a Storybook capture shows it:
 * a headless browser reports no fine pointer.
 *
 * It is rendered at every width, and below `lg` the row carries the gutter
 * itself, because the page margin there is not wide enough to hold it.
 *
 * The rows here are static frames. In the notebook each row holds a block
 * editor or preview, which is why the drag is shown by dimming the row rather
 * than by cloning it into the item's overlay.
 */

const ROWS = [
  {
    id: 'objective',
    label: 'Objective',
    body: 'Evaluate the stability of concentrated lentiviral vector at 4 °C over 28 days.',
  },
  {
    id: 'method',
    label: 'Method',
    body: 'Samples were held at 4 °C and assayed at days 0, 7, 14 and 28 by gcPCR.',
  },
  {
    id: 'observation',
    label: 'Observation',
    body: 'Recovery fell below the 80 % threshold between day 14 and day 28.',
  },
  {
    id: 'conclusion',
    label: 'Conclusion',
    body: 'A 14-day hold at 4 °C is supported by this study.',
  },
]

/**
 * Reordering needs the order somewhere. In the notebook it is the route's
 * canonical blocks plus an optimistic override; here it is local state, so the
 * story carries no business data and no persistence.
 */
function SortableRows({ enabled }: { enabled: boolean }) {
  const [order, setOrder] = React.useState(() => ROWS)

  function move(id: string, targetIndex: number) {
    setOrder((current) => {
      const without = current.filter((row) => row.id !== id)
      const moved = current.find((row) => row.id === id)
      if (!moved) return current
      const at = Math.max(0, Math.min(targetIndex, without.length))
      const next = [...without]
      next.splice(at, 0, moved)
      return next
    })
  }

  return (
    <div className="mx-auto max-w-3xl lg:pl-9">
      <NotebookBlockList ids={order.map((row) => row.id)} onMove={move}>
        {order.map((row) => (
          <NotebookBlockRow
            key={row.id}
            itemId={row.id}
            enabled={enabled}
            handle={enabled ? <NotebookBlockHandle /> : undefined}
            row={{
              className: 'w-full',
              role: enabled ? 'group' : undefined,
              tabIndex: enabled ? 0 : undefined,
              'aria-label': `${row.label} block${enabled ? ' — Alt+Arrow keys move; Ctrl+Arrow keys navigate' : ''}`,
              onKeyDown: (event) => {
                if (!enabled || !event.altKey) return
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                event.preventDefault()
                const target = moveTargetIndex(
                  order.map((entry) => entry.id),
                  row.id,
                  event.key === 'ArrowUp' ? 'up' : 'down',
                )
                if (target !== null) move(row.id, target)
              },
            }}
            frame={{ label: row.label, title: row.label }}
          >
            <p className="text-sm leading-6">{row.body}</p>
          </NotebookBlockRow>
        ))}
      </NotebookBlockList>
    </div>
  )
}

const meta = {
  title: 'Notebook/Sortable list',
  component: NotebookBlockList,
  tags: ['autodocs'],
  // The list takes its contents from the caller, so the args table needs a
  // shape rather than a payload; every story below renders its own.
  args: { ids: [], onMove: () => {}, children: null },
  decorators: [
    (Story) => (
      <div className="bg-background p-6 text-foreground">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NotebookBlockList>

export default meta
type Story = StoryObj<typeof meta>

/** The shipped shape: every row carries a grip, reordering by pointer, touch or keyboard. */
export const Default: Story = {
  render: () => <SortableRows enabled />,
}

/** A notebook that cannot be reordered — the grip is not rendered at all. */
export const Unavailable: Story = {
  render: () => <SortableRows enabled={false} />,
}
