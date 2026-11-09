import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { FavouriteToggle } from '#/components/favourites/favourite-toggle'
import { favouritesQueryKeys } from '#/lib/favourites'
import { screenQueryClient, stubDataClient } from './screen-stories'

/**
 * The star toggle in an object page header. It is optimistic: the star flips at
 * once and the write goes through an RPC, and a failed write rolls the star
 * back and shows a small error. The favourites list is seeded in the query
 * cache and the client refuses every write, so pressing the star shows the
 * rollback and the error message.
 */
const OBJECT_ID = '0198d970-e266-4000-8000-000000000e14'

function withFavourites(favourited: boolean) {
  const client = screenQueryClient({
    data: [
      {
        key: favouritesQueryKeys.list(),
        value: favourited
          ? [
              {
                kind: 'record',
                id: OBJECT_ID,
                createdAt: '2026-11-01T09:00:00.000Z',
              },
            ]
          : [],
      },
    ],
  })

  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={client}>
      <Story />
    </QueryClientProvider>
  )
}

const meta = {
  title: 'Favourites/Toggle',
  component: FavouriteToggle,
  tags: ['autodocs'],
  args: { kind: 'record', objectId: OBJECT_ID, client: stubDataClient() },
} satisfies Meta<typeof FavouriteToggle>

export default meta

type Story = StoryObj<typeof meta>

export const NotFavourited: Story = { decorators: [withFavourites(false)] }

export const Favourited: Story = { decorators: [withFavourites(true)] }

/** A page with no canonical object selected: nothing renders. */
export const NoObject: Story = {
  args: { objectId: null },
  decorators: [withFavourites(false)],
}
