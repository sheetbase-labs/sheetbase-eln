import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { AnalysisChartPicker } from '#/components/notebook/analysis-chart-picker'

import { holdRead, screenQueryClient } from './screen-stories'

/**
 * Adds a saved chart to an analysis block. The saved charts are one read, so
 * the stories seed it (or leave it pending) and nothing is fetched. Choosing a
 * chart saves a new analysis, which a story never sends.
 */
const VIEWS_KEY = ['analysis-views', 'list'] as const

const views = ['Dose response', 'Growth curve', 'Plate heatmap'].map(
  (name, index) => ({
    id: `0198d970-e266-4000-8000-00000000010${index}`,
    workspace_id: 'workspace',
    owner_user_id: 'user-1',
    name,
    display_id: `AV-000${index + 1}`,
    version: 1,
    charts: [],
    source_revisions: [],
    export_settings: null,
    created_at: '2026-10-01T09:00:00Z',
    updated_at: '2026-10-02T09:00:00Z',
  }),
)

const withCharts = screenQueryClient({
  data: [{ key: VIEWS_KEY, value: views }],
})

const noCharts = screenQueryClient({ data: [{ key: VIEWS_KEY, value: [] }] })
const loading = screenQueryClient()

holdRead(loading, VIEWS_KEY)

const meta = {
  title: 'Notebook/Analysis chart picker',
  component: AnalysisChartPicker,
  tags: ['autodocs'],
  args: { statistic: null, onComposed: () => {} },
  decorators: [
    (Story, context) => (
      <QueryClientProvider
        client={
          context.parameters.client as ReturnType<typeof screenQueryClient>
        }
      >
        <Story />
      </QueryClientProvider>
    ),
  ],
} satisfies Meta<typeof AnalysisChartPicker>

export default meta

type Story = StoryObj<typeof meta>

/** No statistic yet: the chosen chart becomes the whole analysis. */
export const SavedCharts: Story = { parameters: { client: withCharts } }

/** Beside a statistic: the chart joins the analysis the block already uses. */
export const BesideAStatistic: Story = {
  parameters: { client: withCharts },
  args: { statistic: { id: 'stat-1', name: 'Mean and spread' } },
}

/** The workspace has no saved charts yet. */
export const NoSavedCharts: Story = { parameters: { client: noCharts } }

/** The saved charts are still loading. */
export const Loading: Story = { parameters: { client: loading } }

/** A locked notebook: the picker is shown but cannot be used. */
export const Disabled: Story = {
  parameters: { client: withCharts },
  args: { disabled: true },
}
