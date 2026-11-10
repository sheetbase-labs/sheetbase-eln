import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  ShortcutProvider,
  useRegisterShortcuts,
} from '#/components/shortcuts/shortcut-provider'
import { Kbd } from '#/components/ui/kbd'
import type { ShortcutDefinition } from '#/lib/shortcuts'

/**
 * The single keydown listener the whole app shares (SHELL-03). Shortcuts match
 * in the active scope, sequences like `g h` buffer for a short time, and keys
 * are ignored while a text field has focus unless the definition says
 * otherwise. Click the frame, then press the keys.
 */
function Playground() {
  // Each firing keeps its own id so the list keys stay stable as it rolls.
  const [fired, setFired] = useState<Array<{ id: number; name: string }>>([])

  const record = (name: string) =>
    setFired((list) =>
      [...list, { id: (list.at(-1)?.id ?? 0) + 1, name }].slice(-5),
    )

  const definitions: ShortcutDefinition[] = [
    {
      id: 'demo-home',
      scope: 'global',
      keys: ['g h'],
      description: 'Go to Home',
      handler: () => record('Go to Home'),
    },
    {
      id: 'demo-search',
      scope: 'global',
      keys: ['/'],
      description: 'Focus search',
      handler: () => record('Focus search'),
    },
  ]

  return (
    <ShortcutProvider definitions={definitions}>
      <div className="flex w-80 flex-col gap-3 text-body">
        <p className="m-0 text-fg-muted">
          Press <Kbd>g</Kbd> then <Kbd>h</Kbd>, or <Kbd>/</Kbd>. Typing in the
          box below fires nothing.
        </p>
        <input
          aria-label="A text field"
          className="rounded-md border border-border px-2 py-1"
          placeholder="Shortcuts are ignored here"
        />
        <ul className="m-0 list-none p-0" aria-label="Fired shortcuts">
          {fired.length === 0 ? (
            <li className="text-fg-muted">Nothing fired yet.</li>
          ) : (
            fired.map((entry) => <li key={entry.id}>{entry.name}</li>)
          )}
        </ul>
      </div>
    </ShortcutProvider>
  )
}

const meta = {
  title: 'Shortcuts/Provider',
  component: ShortcutProvider,
  tags: ['autodocs'],
  args: { definitions: [], children: null },
} satisfies Meta<typeof ShortcutProvider>

export default meta

type Story = StoryObj<typeof meta>

export const Interactive: Story = { render: () => <Playground /> }

function Registered() {
  const [last, setLast] = useState('none yet')
  useRegisterShortcuts([
    {
      id: 'demo-route',
      scope: 'global',
      keys: ['r'],
      description: 'Route action',
      handler: () => setLast('Route action'),
    },
  ])

  return (
    <p className="m-0 text-body">
      Press <Kbd>r</Kbd>. Last fired: {last}
    </p>
  )
}

/** A screen registers its own shortcuts while it is mounted. */
export const RouteRegistered: Story = {
  render: () => (
    <ShortcutProvider definitions={[]}>
      <Registered />
    </ShortcutProvider>
  ),
}
