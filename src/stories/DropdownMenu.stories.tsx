import type { Meta, StoryObj } from '@storybook/tanstack-react'
// Trash2 (delete) has no v3 equivalent.
import { Trash2 } from 'lucide-react'

import { Icon } from '#/components/icons'
import { Button } from '#/components/v3/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'

const meta = {
  title: 'UI/DropdownMenu',
  component: DropdownMenu,
  tags: ['autodocs'],
} satisfies Meta<typeof DropdownMenu>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {
  render: () => (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary">
          <Icon name="more" />
          Actions
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuLabel>Record actions</DropdownMenuLabel>
          <DropdownMenuItem>
            <Icon name="edit" />
            Edit<DropdownMenuShortcut>⌘E</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Icon name="copy" />
            Duplicate
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive">
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}
export const WithCheckboxes: Story = {
  render: () => (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary">Columns</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuCheckboxItem checked>Identifier</DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked>Status</DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem>Owner</DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}
