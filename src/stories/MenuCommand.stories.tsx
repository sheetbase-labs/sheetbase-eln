import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Button } from '#/components/v3/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '#/components/v3/ui/command'
import {
  ButtonGroup,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '#/components/ui'

const meta = { title: 'UI/Menu & command', tags: ['autodocs'] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>
export const CommandPalette: Story = {
  render: () => (
    <Command label="Search records" className="max-w-md rounded border">
      <CommandInput placeholder="Search records…" />
      <CommandList>
        <CommandEmpty>No records found.</CommandEmpty>
        <CommandGroup heading="Experiments">
          <CommandItem value="EXP-2026-0042 · Stability assay">
            EXP-2026-0042 · Stability assay
            <span className="ml-auto text-label text-fg-muted">⌘1</span>
          </CommandItem>
          <CommandItem value="EXP-2026-0043 · Dose response">
            EXP-2026-0043 · Dose response
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Samples">
          <CommandItem value="SMP-2026-0142 · Plasma aliquot">
            SMP-2026-0142 · Plasma aliquot
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  ),
}
export const DetailedMenu: Story = {
  render: () => (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger asChild>
        <Button>View options</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuLabel>Display</DropdownMenuLabel>
          <DropdownMenuCheckboxItem checked>
            Show archived
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value="compact">
          <DropdownMenuRadioItem value="compact">Compact</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="comfortable">
            Comfortable
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Export</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem>
              CSV<DropdownMenuShortcut>⌘E</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}
export const GroupedButtons: Story = {
  render: () => (
    <ButtonGroup>
      <Button variant="secondary">Day</Button>
      <Button variant="secondary">Week</Button>
      <Button variant="secondary">Month</Button>
    </ButtonGroup>
  ),
}
