import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  JoinOfferBanner,
  JoinOfferMenuItem,
} from '#/components/shell/join-offer-banner'
import {
  DropdownMenu,
  DropdownMenuContent,
} from '#/components/ui/dropdown-menu'
import { joinDomainKeys } from '#/lib/join-domains'
import { screenQueryClient, screenRoutes } from './screen-stories'

/**
 * The lab someone's email domain opens, offered to a person who signed up
 * before the domain was added and so has a workspace of their own. Nothing
 * moves until they choose Join; Not now hides the offer on this device. The
 * offer is seeded in the query cache; joining is refused because a story never
 * reaches the server.
 */
const OFFER = {
  workspace_id: '0198d970-e266-4000-8000-0000000000e2',
  workspace_name: 'Acme Bio',
  domain: 'acme-bio.com',
  role: 'scientist',
}

function withOffer(offer: typeof OFFER | null) {
  const client = screenQueryClient({
    data: [{ key: joinDomainKeys.offer, value: offer }],
  })

  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={client}>
      <div className="w-[640px]">
        <Story />
      </div>
    </QueryClientProvider>
  )
}

const meta = {
  title: 'Shell/Join offer banner',
  component: JoinOfferBanner,
  tags: ['autodocs'],
  parameters: {
    tanstack: { router: { route: screenRoutes('/'), path: '/' } },
  },
  decorators: [withOffer(OFFER)],
} satisfies Meta<typeof JoinOfferBanner>

export default meta

type Story = StoryObj<typeof meta>

export const Offered: Story = {}

/** No domain matches this person: the banner is silent. */
export const NoOffer: Story = { decorators: [withOffer(null)] }

/** The workspace menu's own row for the same offer. */
export const MenuItem: Story = {
  render: () => (
    <DropdownMenu open>
      <DropdownMenuContent>
        <JoinOfferMenuItem />
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}
