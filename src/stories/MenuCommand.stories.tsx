import type { Meta, StoryObj } from '@storybook/tanstack-react'
import {
  Button,
  ButtonGroup,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
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
    <Command className="max-w-md rounded border">
      <CommandInput placeholder="Search records…" />
      <CommandList>
        <CommandEmpty>No records found.</CommandEmpty>
        <CommandGroup heading="Experiments">
          <CommandItem>
            EXP-2026-0042 · Stability assay<CommandShortcut>⌘1</CommandShortcut>
          </CommandItem>
          <CommandItem>EXP-2026-0043 · Dose response</CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Samples">
          <CommandItem>SMP-2026-0142 · Plasma aliquot</CommandItem>
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
        <DropdownMenuLabel>Display</DropdownMenuLabel>
        <DropdownMenuCheckboxItem checked>
          Show archived
        </DropdownMenuCheckboxItem>
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
      <Button variant="outline">Day</Button>
      <Button variant="secondary">Week</Button>
      <Button variant="outline">Month</Button>
    </ButtonGroup>
  ),
}
