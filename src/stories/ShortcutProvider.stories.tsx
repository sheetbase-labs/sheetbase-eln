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
  const [fired, setFired] = useState<string[]>([])

  const definitions: ShortcutDefinition[] = [
    {
      id: 'demo-home',
      scope: 'global',
      keys: ['g h'],
      description: 'Go to Home',
      handler: () => setFired((list) => [...list, 'Go to Home'].slice(-5)),
    },
    {
      id: 'demo-search',
      scope: 'global',
      keys: ['/'],
      description: 'Focus search',
      handler: () => setFired((list) => [...list, 'Focus search'].slice(-5)),
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
            fired.map((name, index) => <li key={index}>{name}</li>)
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
