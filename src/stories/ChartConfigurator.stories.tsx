import { useState } from 'react'
import type { ComponentProps } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { expect, userEvent, within } from 'storybook/test'

import { ChartConfigurator } from '#/components/viz/chart-configurator'
import { AuthoringProposal } from '#/components/viz/authoring-proposal'
import { ChartRenderer } from '#/components/viz/chart-renderer'
import type { CanonicalDatasetSource } from '#/lib/chart-data'
import { CHART_SPEC_VERSION, materialiseChart } from '#/lib/chart-spec'
import type { ChartRow, ChartSpec } from '#/lib/chart-spec'
import { PageAiWorkspaceProvider } from '#/lib/use-page-ai'

/**
 * Controlled chart authoring: the spec lives with the caller, so each story
 * supplies a small stateful caller. The seed spec is deliberately partial
 * (x and y bound only) — that is the state the configurator is designed to
 * complete.
 */
const DATASET_ID = '11111111-1111-1111-8111-111111111111'
const TIME = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa01'
const OD = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa02'
const CONDITION = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa03'

const source: CanonicalDatasetSource = {
  datasetId: DATASET_ID,
  name: 'Plate reader kinetics',
  workspaceId: '00000000-0000-4000-8000-00000000ffff',
  schemaVersionId: '00000000-0000-4000-8000-00000000fffe',
  schemaVersionNumber: 1,
  revision: 2,
  columns: [
    { id: TIME, label: 'Time (h)', logicalType: 'decimal', unit: 'h' },
    { id: OD, label: 'OD₆₀₀', logicalType: 'decimal' },
    { id: CONDITION, label: 'Condition', logicalType: 'category' },
  ],
}

const baseSpec: ChartSpec = {
  specVersion: CHART_SPEC_VERSION,
  type: 'line',
  datasets: [{ datasetId: DATASET_ID }],
  fields: {
    x: { fieldId: TIME },
    y: { fieldId: OD },
    series: null,
    color: null,
    size: null,
    facet: null,
  },
  filters: [],
  transformations: [],
  typeParams: {},
  display: {
    axes: { x: { scale: 'linear' }, y: { scale: 'linear' } },
    series: [],
  },
  overlays: { errorBars: null },
}

function Caller({
  initialSpec,
  ...props
}: { initialSpec: ChartSpec } & Omit<
  ComponentProps<typeof ChartConfigurator>,
  'spec' | 'onSpecChange'
>) {
  const [spec, setSpec] = useState(initialSpec)

  return (
    <div className="w-[900px] max-w-full">
      <ChartConfigurator {...props} spec={spec} onSpecChange={setSpec} />
    </div>
  )
}

const meta = {
  title: 'Visualization/Chart configurator',
  component: ChartConfigurator,
  tags: ['autodocs'],
  args: { source, spec: baseSpec, onSpecChange: () => {} },
} satisfies Meta<typeof ChartConfigurator>

export default meta

type Story = StoryObj<typeof meta>

export const Wrap: Story = {
  render: (args) => <Caller {...args} initialSpec={baseSpec} />,
}

/** Rail is the narrow stacked column used beside a chart preview. */
export const Rail: Story = {
  args: { layout: 'rail' },
  render: (args) => (
    <div className="w-[280px]">
      <Caller {...args} initialSpec={baseSpec} />
    </div>
  ),
}

/** A series binding turns the chart into one line per condition. */
export const WithSeries: Story = {
  render: (args) => (
    <Caller
      {...args}
      initialSpec={{
        ...baseSpec,
        fields: { ...baseSpec.fields, series: { fieldId: CONDITION } },
      }}
    />
  ),
}

/** Bar charts expose the stacking parameter that only they use. */
export const StackedBar: Story = {
  render: (args) => (
    <Caller
      {...args}
      initialSpec={{
        ...baseSpec,
        type: 'bar',
        typeParams: { bar: { stacking: 'stacked' } },
        fields: { ...baseSpec.fields, series: { fieldId: CONDITION } },
      }}
    />
  ),
}

const proposalSource: ComponentProps<typeof AuthoringProposal>['source'] = {
  ...source,
  columns: [source.columns[1], source.columns[0], source.columns[2]],
}

const proposalRows: ChartRow[] = [
  { [TIME]: 0, [OD]: 0.05, [CONDITION]: 'Control' },
  { [TIME]: 2, [OD]: 0.12, [CONDITION]: 'Control' },
  { [TIME]: 4, [OD]: 0.34, [CONDITION]: 'Treated' },
  { [TIME]: 6, [OD]: 0.68, [CONDITION]: 'Treated' },
]

/** Acceptance loads the proposal into a real chart, not an event log. */
function ProposalCaller({
  proposalDataset,
}: {
  proposalDataset: ComponentProps<typeof AuthoringProposal>['source']
}) {
  const [spec, setSpec] = useState(baseSpec)
  const [client] = useState(() => new QueryClient())

  return (
    <QueryClientProvider client={client}>
      <PageAiWorkspaceProvider value={null}>
        <div className="w-[900px] max-w-full space-y-3">
          <AuthoringProposal source={proposalDataset} onSpecChange={setSpec} />
          <ChartRenderer
            title={source.name}
            spec={spec}
            materialised={materialiseChart(spec, source.columns, proposalRows)}
            frozen={null}
          />
        </div>
      </PageAiWorkspaceProvider>
    </QueryClientProvider>
  )
}

/** Preview and discard never load the generated bar spec into the line chart. */
export const ProposalPreview: Story = {
  render: () => <ProposalCaller proposalDataset={proposalSource} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const figure = await canvas.findByRole('figure', { name: source.name })
    await expect(figure).toHaveAccessibleDescription(/^line chart/)
    await userEvent.click(canvas.getByRole('button', { name: 'Propose chart' }))
    await expect(
      canvas.getByRole('note', { name: 'Generated draft' }),
    ).toBeVisible()
    await expect(canvas.getByText('Chart preview (bar)')).toBeVisible()
    await expect(figure).toHaveAccessibleDescription(/^line chart/)
    await userEvent.click(canvas.getByRole('button', { name: 'Discard' }))
    await expect(
      canvas.queryByRole('note', { name: 'Generated draft' }),
    ).not.toBeInTheDocument()
    await expect(figure).toHaveAccessibleDescription(/^line chart/)
    await userEvent.click(canvas.getByRole('button', { name: 'Propose chart' }))
    await expect(
      canvas.getByRole('note', { name: 'Generated draft' }),
    ).toBeVisible()
  },
}

/**
 * Acceptance loads the categorical bar spec. The current numeric point
 * materializer drops categorical x values, so this is a known empty-plot
 * limitation, not evidence of successful plotted categorical acceptance.
 */
export const ProposalAccepted: Story = {
  render: () => <ProposalCaller proposalDataset={proposalSource} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const figure = await canvas.findByRole('figure', { name: source.name })
    await expect(figure).toHaveAccessibleDescription(/^line chart/)
    await userEvent.click(canvas.getByRole('button', { name: 'Propose chart' }))
    await expect(canvas.getByText('Chart preview (bar)')).toBeVisible()
    await expect(figure).toHaveAccessibleDescription(/^line chart/)
    await userEvent.click(
      canvas.getByRole('button', { name: 'Accept and load chart' }),
    )
    await expect(
      canvas.queryByRole('note', { name: 'Generated draft' }),
    ).not.toBeInTheDocument()
    await expect(figure).toHaveAccessibleDescription(
      /^bar chart of OD₆₀₀ against Condition/,
    )
  },
}

/** Numeric fields prove acceptance with actual asymmetric plotted values. */
export const NumericProposalAccepted: Story = {
  render: () => (
    <ProposalCaller
      proposalDataset={{
        ...proposalSource,
        columns: [source.columns[1], source.columns[0]],
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const figure = await canvas.findByRole('figure', { name: source.name })
    await expect(figure).toHaveAccessibleDescription(/^line chart/)
    await userEvent.click(canvas.getByRole('button', { name: 'Propose chart' }))
    await expect(canvas.getByText('Chart preview (scatter)')).toBeVisible()
    await expect(figure).toHaveAccessibleDescription(/^line chart/)
    await userEvent.click(
      canvas.getByRole('button', { name: 'Accept and load chart' }),
    )
    await expect(
      canvas.queryByRole('note', { name: 'Generated draft' }),
    ).not.toBeInTheDocument()
    await expect(figure).toHaveAccessibleDescription(
      /^scatter chart of OD₆₀₀ against Time \(h\)/,
    )
    await expect(
      within(figure).getByRole('group', {
        name: 'scatter chart of OD₆₀₀ against Time (h)',
      }),
    ).toBeVisible()
    await userEvent.click(
      within(figure).getByText('Show data table (4 points)'),
    )
    await expect(within(figure).getAllByRole('row')).toHaveLength(5)
    await expect(
      within(figure).getByRole('row', { name: /2 0\.12/ }),
    ).toBeVisible()
    await expect(
      within(figure).getByRole('row', { name: /6 0\.68/ }),
    ).toBeVisible()
  },
}

/** An unavailable proposal leaves the caller's existing chart untouched. */
export const ProposalUnavailable: Story = {
  render: () => <ProposalCaller proposalDataset={{ ...source, columns: [] }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const figure = await canvas.findByRole('figure', { name: source.name })
    await expect(figure).toHaveAccessibleDescription(/^line chart/)
    await userEvent.click(canvas.getByRole('button', { name: 'Propose chart' }))
    await expect(
      canvas.getByText(
        'No suggestion available for these fields — configure the chart by hand.',
      ),
    ).toBeVisible()
    await expect(
      canvas.queryByRole('note', { name: 'Generated draft' }),
    ).not.toBeInTheDocument()
    await expect(
      canvas.queryByRole('button', { name: 'Accept and load chart' }),
    ).not.toBeInTheDocument()
    await expect(figure).toHaveAccessibleDescription(/^line chart/)
  },
}
