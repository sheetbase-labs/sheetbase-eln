import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Button } from '#/components/v3/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/v3/ui/dropdown-menu'

/**
 * The forward kit's menu: a list of commands or destinations on a trigger. Base
 * UI gives it the keyboard contract the kit relies on — focus moves into the
 * menu and is trapped, Esc closes, focus returns to the trigger, and the arrow
 * keys walk the items.
 *
 * The legacy `UI/DropdownMenu` story covers `src/components/ui/dropdown-menu.tsx`.
 */
const meta = {
  title: 'v3 kit/Dropdown menu',
  component: DropdownMenu,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof DropdownMenu>
export default meta
type Story = StoryObj<typeof meta>

/** Commands, hints and a destructive item last, which is the app's row menu. */
export const Default: Story = {
  render: () => (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger render={<Button icon="more" />} />
      <DropdownMenuContent>
        <DropdownMenuItem icon="edit">Rename</DropdownMenuItem>
        <DropdownMenuItem icon="copy" hint="⌘D">
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem icon="download">Export as CSV</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem icon="archive">Archive</DropdownMenuItem>
        <DropdownMenuItem icon="x" danger>
          Delete block
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}

/** Grouped by heading, when one menu carries two kinds of command. */
export const Grouped: Story = {
  render: () => (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger render={<Button />}>Add to</DropdownMenuTrigger>
      <DropdownMenuContent>
        {/* A label must sit inside its group: Base UI's `Menu.GroupLabel` reads
            `MenuGroupContext` and throws without it, which unmounts the menu. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>This record</DropdownMenuLabel>
          <DropdownMenuItem icon="plus">Block</DropdownMenuItem>
          <DropdownMenuItem icon="plus">Figure</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuGroup>
          <DropdownMenuLabel>Elsewhere</DropdownMenuLabel>
          <DropdownMenuItem icon="link">Propose to a notebook</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}

/** An item that is not available here stays visible and says so. */
export const WithDisabledItem: Story = {
  render: () => (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger render={<Button />}>Run</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem icon="play">Run now</DropdownMenuItem>
        <DropdownMenuItem icon="clock" disabled>
          Schedule (not in this release)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}
