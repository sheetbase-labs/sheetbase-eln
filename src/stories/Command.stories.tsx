import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Button } from '#/components/v3/ui/button'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandLoading,
  CommandPopover,
  CommandSeparator,
} from '#/components/v3/ui/command'
import { Icon } from '#/components/v3/icons'

/**
 * The forward kit's Command (src/components/v3/ui/command.tsx): the one
 * grouped, keyboard-driven list. It is what the search palette, the record
 * pickers and the notebook's add-block menu compose, and it replaced the
 * legacy cmdk palette (`src/components/ui/command.tsx`) which this change
 * deleted.
 */
const meta = {
  title: 'UI/Command',
  component: Command,
  tags: ['autodocs'],
  args: { label: 'Commands' },
} satisfies Meta<typeof Command>
export default meta
type Story = StoryObj<typeof meta>

const items = (
  <>
    <CommandEmpty>No records found.</CommandEmpty>
    <CommandGroup heading="Experiments">
      <CommandItem value="EXP-2026-0042 Stability assay">
        <Icon name="flask" size={14} />
        EXP-2026-0042 · Stability assay
      </CommandItem>
      <CommandItem value="EXP-2026-0043 Dose response">
        <Icon name="flask" size={14} />
        EXP-2026-0043 · Dose response
      </CommandItem>
    </CommandGroup>
    <CommandSeparator />
    <CommandGroup heading="Samples">
      <CommandItem value="SMP-2026-0142 Plasma aliquot">
        <Icon name="tube" size={14} />
        SMP-2026-0142 · Plasma aliquot
      </CommandItem>
    </CommandGroup>
  </>
)

export const Default: Story = {
  render: (args) => (
    <Command {...args} className="w-96 rounded-lg border border-border">
      <CommandInput placeholder="Search records…" />
      <CommandList>{items}</CommandList>
      <CommandFooter />
    </Command>
  ),
}

export const Empty: Story = {
  render: (args) => (
    <Command
      {...args}
      query="nothing matches this"
      className="w-96 rounded-lg border border-border"
    >
      <CommandInput placeholder="Search records…" autoFocus={false} />
      <CommandList>{items}</CommandList>
    </Command>
  ),
}

export const Loading: Story = {
  render: (args) => (
    <Command {...args} loading className="w-96 rounded-lg border border-border">
      <CommandInput placeholder="Search records…" autoFocus={false} />
      <CommandList>
        <CommandLoading loading rows={3} />
      </CommandList>
    </Command>
  ),
}

/** The picker form: a CommandPopover on a trigger button. */
export const Picker: Story = {
  render: (args) => {
    const [open, setOpen] = useState(true)
    return (
      <CommandPopover
        open={open}
        onOpenChange={setOpen}
        trigger={<Button variant="secondary">Link a record</Button>}
      >
        <Command {...args} className="min-h-0">
          <CommandInput placeholder="Search records…" autoFocus={false} />
          <CommandList className="max-h-64">{items}</CommandList>
        </Command>
      </CommandPopover>
    )
  },
}

/** The modal form: a CommandDialog. */
export const Dialog: Story = {
  render: (args) => {
    const [open, setOpen] = useState(true)
    return (
      <>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Open command
        </Button>
        <CommandDialog
          open={open}
          onOpenChange={setOpen}
          title="Search Sheetbase"
        >
          <Command {...args} className="min-h-0">
            <CommandInput placeholder="Search records…" autoFocus={false} />
            <CommandList>{items}</CommandList>
            <CommandFooter />
          </Command>
        </CommandDialog>
      </>
    )
  },
}
