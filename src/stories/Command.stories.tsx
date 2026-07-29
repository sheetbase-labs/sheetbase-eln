import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { FileText, FlaskConical, Settings } from 'lucide-react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '#/components/ui/command'

const meta = {
  title: 'UI/Command',
  component: Command,
  tags: ['autodocs'],
} satisfies Meta<typeof Command>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {
  render: () => (
    <Command className="w-96 rounded-lg border shadow-md">
      <CommandInput placeholder="Search commands…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Records">
          <CommandItem>
            <FlaskConical />
            Experiments<CommandShortcut>⌘E</CommandShortcut>
          </CommandItem>
          <CommandItem>
            <FileText />
            Protocols
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="System">
          <CommandItem>
            <Settings />
            Settings
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  ),
}
export const EmptyState: Story = {
  render: () => (
    <Command className="w-96 rounded-lg border">
      <CommandInput value="missing" readOnly />
      <CommandList>
        <CommandEmpty>No matching records.</CommandEmpty>
      </CommandList>
    </Command>
  ),
}
