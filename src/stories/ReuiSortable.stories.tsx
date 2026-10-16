import * as React from 'react'

import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Icon } from '#/components/v3/icons'
import {
  Sortable,
  SortableItem,
  SortableItemHandle,
} from '#/components/reui/sortable'

/**
 * The adopted registry item, on its own: ReUI's `@reui/sortable`, installed
 * from the pinned base-nova registry and placed by hand at
 * `src/components/reui/sortable.tsx` (ADR-0055 decision 2). The notebook
 * renders it through `src/components/notebook/notebook-block-reorder.tsx`; this
 * story is the item's own contract, so that a future registry update can be
 * compared against the shape it was adopted at.
 *
 * Two things about it are worth knowing before reading this:
 *
 * - `Sortable` owns the order through `onValueChange` (the contract used here),
 *   or hands the move to the consumer through `onMove` when the order belongs
 *   elsewhere — which is what the notebook does, because its order is the
 *   route's canonical blocks and not local state.
 * - `SortableItem` puts `@dnd-kit`'s widget role and tab stop on the row
 *   container while the drag listeners sit on the handle inside it. As
 *   published that is axe-clean, because the handle it renders by default is a
 *   non-focusable `div` — and for that same reason its keyboard sensor is
 *   unreachable. So an integration has to render the handle as a real button
 *   and give the row container the semantics of the list it is in; both halves
 *   of that measurement are pinned in
 *   `src/components/component-compare/component-compare.a11y.test.tsx`.
 */

const ITEMS = ['Objective', 'Method', 'Observation', 'Conclusion']

const meta = {
  title: 'UI/ReUI sortable',
  component: Sortable,
  tags: ['autodocs'],
  // The item's shape, for the args table; the story below owns its own items.
  args: {
    value: [],
    onValueChange: () => {},
    getItemValue: () => '',
    children: null,
  },
  decorators: [
    (Story) => (
      <div className="bg-background p-6 text-foreground">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Sortable>

export default meta
type Story = StoryObj<typeof meta>

/** A vertical list: drag a grip with the pointer or a finger, or lift it with the keyboard. */
export const Default: Story = {
  render: () => {
    const List = () => {
      const [items, setItems] = React.useState(ITEMS)
      return (
        <Sortable
          value={items}
          onValueChange={setItems}
          getItemValue={(item: string) => item}
          strategy="vertical"
          className="mx-auto flex max-w-md flex-col gap-1"
        >
          {items.map((item) => (
            <SortableItem
              key={item}
              value={item}
              render={<div />}
              role="group"
              tabIndex={0}
              aria-label={`${item} — a row, not a button`}
              className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <SortableItemHandle
                render={<button type="button" />}
                aria-label={`Reorder ${item}`}
                className="rounded p-0.5 text-fg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Icon name="move" size={14} />
              </SortableItemHandle>
              <span className="text-body">{item}</span>
            </SortableItem>
          ))}
        </Sortable>
      )
    }
    return <List />
  },
}
