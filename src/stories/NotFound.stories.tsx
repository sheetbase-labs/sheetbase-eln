import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { NotFound } from '#/components/v3/shell/not-found'
import { screenRoutes } from './screen-stories'

/**
 * The not-found screen (`not-found.tsx`), which the catch-all route renders for
 * any address the app has no page for. What it shows depends on where the
 * address sits: inside a record layout there is already an h1 above it, so it
 * renders body-only and says the part of the record is missing; anywhere else it
 * owns the page, names the address, and offers the section the address belongs
 * to.
 *
 * The sandbox router therefore has to hold the *matched route*, not just the
 * path — and a record route has to be nested under its section, which is why
 * these stories register `['/datasets', '$datasetId']` rather than the two paths
 * side by side.
 */
const MISSING_DATASET_ID = '0198d970-e266-4000-8000-0000000000f1'
const MISSING_INSTRUMENT_ID = '0198d970-e266-4000-8000-0000000000f2'

const meta = {
  title: 'Shell/Not found',
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/**
 * The framework types `path` and `params` against the app's own route tree,
 * where the union of every registered path demands every route's params at
 * once. A story's sandbox router is not that tree, so the two options are
 * written once here instead of casting in each story.
 */
function sandboxRouter(router: {
  route: ReturnType<typeof screenRoutes>
  path: string
  params?: Record<string, string>
}): NonNullable<Story['parameters']> {
  return { tanstack: { router } } as NonNullable<Story['parameters']>
}

/**
 * Inside a record: the record's layout already owns the page heading, so the
 * screen states what is missing without repeating it, and the one route back is
 * the section the record belongs to.
 */
export const InsideARecord: Story = {
  parameters: sandboxRouter({
    route: screenRoutes('/datasets/$datasetId', ['/search']),
    path: '/datasets/$datasetId',
    params: { datasetId: MISSING_DATASET_ID },
  }),
  render: () => <NotFound />,
}

/**
 * The same kind of address one level out: an instrument id is not a record
 * layout that renders its own heading, so the screen owns the page — the address
 * is its title and the way back is the instrument registry.
 */
export const UnknownRecord: Story = {
  parameters: sandboxRouter({
    route: screenRoutes('/instruments/$instrumentId', ['/search']),
    path: '/instruments/$instrumentId',
    params: { instrumentId: MISSING_INSTRUMENT_ID },
  }),
  render: () => <NotFound />,
}

/**
 * An address under no section the product has: there is no list to return to,
 * so the one next step is Home. In the app this address is reached through the
 * catch-all; a sandbox cannot resolve the catch-all's own route, so the story
 * declares the address it stands for instead, ahead of the loose `/` that would
 * otherwise shadow it.
 */
export const UnknownAddress: Story = {
  parameters: sandboxRouter({
    route: screenRoutes('/reports/q3', ['/search', '/']),
    path: '/reports/q3',
  }),
  render: () => <NotFound />,
}
