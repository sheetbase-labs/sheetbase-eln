import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  DataAccessButton,
  DataAccessPanel,
  PaneDataAccess,
} from '#/components/data-access/data-access-panel'
import { resolveDataAccessHandle } from '#/lib/data-access-handles'
import type { DataAccessHandle } from '#/lib/data-access-handles'
import { QueryClientProvider } from '@tanstack/react-query'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/ui/popover'
import { screenQueryClient, screenRoutes } from './screen-stories'

/**
 * Keys, routes and snippets for one page, for the roles that use them: the
 * model key, the record reference, the REST route, the SQL relation and a
 * snippet in each language. `PaneDataAccess` works the handle out from a pane's
 * address, and `DataAccessButton` is the `{ }` button in a page header.
 */
const LIST = resolveDataAccessHandle('/experiments') as DataAccessHandle

const RECORD = resolveDataAccessHandle(
  '/experiments/EXP-2026-0042',
) as DataAccessHandle

const client = screenQueryClient()

const meta = {
  title: 'Data access/Panel',
  component: DataAccessPanel,
  tags: ['autodocs'],
  parameters: {
    tanstack: {
      router: {
        route: screenRoutes('/', ['/settings/account/api']),
        path: '/',
      },
    },
  },
  decorators: [
    (Story) => (
      <QueryClientProvider client={client}>
        <Story />
      </QueryClientProvider>
    ),
  ],
  args: { handle: LIST },
} satisfies Meta<typeof DataAccessPanel>

export default meta

type Story = StoryObj<typeof meta>

/** The panel sits in a popover, as it does under the header button. */
function InPopover({ handle }: { handle: DataAccessHandle }) {
  return (
    <Popover open>
      <PopoverTrigger render={<span className="inline-block h-1 w-1" />} />
      <PopoverContent align="start">
        <DataAccessPanel handle={handle} />
      </PopoverContent>
    </Popover>
  )
}

/** A list page. */
export const List: Story = {
  render: (args) => <InPopover handle={args.handle} />,
}

/** A single record, addressed by its display ID. */
export const Record: Story = {
  args: { handle: RECORD },
  render: (args) => <InPopover handle={args.handle} />,
}

/** The header button; the panel opens in a popover. */
export const Button: Story = {
  render: () => <DataAccessButton handle={RECORD} />,
}

/** The button for a pane's address; panes with no data handle render nothing. */
export const ForPane: Story = {
  render: () => <PaneDataAccess href="/experiments/EXP-2026-0042" />,
}

export const ForPaneWithoutHandle: Story = {
  render: () => <PaneDataAccess href="/settings" />,
}
