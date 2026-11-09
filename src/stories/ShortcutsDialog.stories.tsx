import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Button } from '#/components/ui/button'
import { ShortcutProvider } from '#/components/shortcuts/shortcut-provider'
import {
  RegistryShortcutsDialog,
  ShortcutGroups,
  ShortcutKeys,
  ShortcutsDialog,
} from '#/components/shortcuts/shortcuts-dialog'
import { PANE_SHORTCUTS, SCOPED_SHORTCUTS } from '#/lib/shortcut-scopes'
import type { ShortcutDefinition } from '#/lib/shortcuts'

/**
 * The keyboard-shortcuts dialog (SHELL-03), generated from the registry so it
 * can never drift from the shortcuts that actually fire. `ShortcutKeys` and
 * `ShortcutGroups` are the shared presentation the dialog and the help pages
 * both use.
 */
const DEFINITIONS: ShortcutDefinition[] = [
  {
    id: 'go-home',
    scope: 'global',
    keys: ['g h'],
    description: 'Go to Home',
  },
  {
    id: 'open-search',
    scope: 'global',
    keys: ['Mod+k'],
    description: 'Search everything',
  },
  ...PANE_SHORTCUTS,
  ...SCOPED_SHORTCUTS,
]

const meta = {
  title: 'Shortcuts/Dialog',
  component: ShortcutsDialog,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: { open: true, onOpenChange: () => {}, definitions: DEFINITIONS },
} satisfies Meta<typeof ShortcutsDialog>

export default meta

type Story = StoryObj<typeof meta>

/** Open, with every scope the registry holds grouped under its heading. */
export const Open: Story = {}

/** Only the global scope: a single column, no grid. */
export const OneScope: Story = {
  args: { definitions: DEFINITIONS.filter((item) => item.scope === 'global') },
}

/** The dialog as the shell mounts it, reading the registry from the provider. */
export const FromRegistry: Story = {
  render: function Render() {
    const [open, setOpen] = useState(true)

    return (
      <ShortcutProvider definitions={DEFINITIONS}>
        <div className="p-6">
          <Button onClick={() => setOpen(true)}>Show shortcuts</Button>
        </div>
        <RegistryShortcutsDialog open={open} onOpenChange={setOpen} />
      </ShortcutProvider>
    )
  },
}

/** The binding presentation on its own: modifiers, plain keys and sequences. */
export const Keys: Story = {
  render: () => (
    <div className="flex flex-col gap-2 text-body">
      <ShortcutKeys bindings={['Mod+k']} platform="mac" />
      <ShortcutKeys bindings={['Mod+k']} platform="other" />
      <ShortcutKeys bindings={['g h']} platform="mac" />
      <ShortcutKeys bindings={['Shift+?', '/']} platform="other" />
    </div>
  ),
}

/** The grouped list the help pages embed. */
export const Groups: Story = {
  render: () => <ShortcutGroups definitions={DEFINITIONS} platform="mac" />,
  parameters: { layout: 'padded' },
}
