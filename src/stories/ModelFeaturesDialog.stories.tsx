import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ModelFeaturesDialog } from '#/components/models/model-features-dialog'
import { featureKeys } from '#/lib/features/data'
import { screenQueryClient, screenRoutes } from './screen-stories'
import { cellBankModel } from './model-fixtures'

/**
 * The Features button on a model: the optional features the lab can switch on
 * for its records. The read is seeded, so nothing is fetched.
 */
const meta = {
  title: 'Models/Features dialog',
  parameters: {
    layout: 'fullscreen',
    tanstack: {
      router: {
        route: screenRoutes('/models'),
        path: '/models',
      },
    },
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const client = (on: boolean) =>
  screenQueryClient({
    data: [
      {
        key: featureKeys.list,
        value: on
          ? [{ model_key: 'cell_bank', capability: 'campaigns', settings: {} }]
          : [],
      },
    ],
  })
const off = client(false)
const on = client(true)

/** A model with no features switched on. */
export const NothingOn: Story = {
  render: () => (
    <QueryClientProvider client={off}>
      <ModelFeaturesDialog open onOpenChange={() => {}} model={cellBankModel} />
    </QueryClientProvider>
  ),
}

/** A model with Campaigns switched on. */
export const CampaignsOn: Story = {
  render: () => (
    <QueryClientProvider client={on}>
      <ModelFeaturesDialog open onOpenChange={() => {}} model={cellBankModel} />
    </QueryClientProvider>
  ),
}
