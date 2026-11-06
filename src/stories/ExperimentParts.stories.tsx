import { QueryClientProvider } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { expect, screen, userEvent } from 'storybook/test'

import { SavedTrails } from '#/components/audit/saved-trails'
import { ResultsWorkspace } from '#/components/experiments/results-workspace'
import { SaveAsTemplateDialog } from '#/components/experiments/save-as-template-dialog'
import { Button } from '#/components/ui/button'
import { analysisStudioQueryKeys } from '#/lib/analysis-studio-data'
import type { AnalysisViewWire } from '#/lib/analysis-studio-data'
import type { CanonicalDatasetSource } from '#/lib/chart-data'
import { CHART_SPEC_VERSION } from '#/lib/chart-spec'
import type { ChartSpec } from '#/lib/chart-spec'
import { screenQueryClient, screenRoutes, withApiReads } from './screen-stories'
import type { ReadSeed } from './screen-stories'

/**
 * Pieces of an experiment's page (`src/components/experiments/`) and the
 * saved-trails list that sits above a record's evidence
 * (`src/components/audit/saved-trails`): booking an instrument, saving the
 * experiment as a template, the results board, and the trails people saved.
 */
const EXP_ID = '0198d970-e266-4000-8000-000000000e01'

const meta = {
  title: 'Experiments/Page parts',
  parameters: {
    tanstack: {
      router: {
        route: screenRoutes('/experiments/$expId/results', [
          '/schedule',
          '/analysis/new',
          '/templates/$templateId',
        ]),
        path: '/experiments/$expId/results',
        params: { expId: EXP_ID },
      },
    },
  },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

function inside(queryClient: QueryClient, width = 960) {
  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={queryClient}>
      <div style={{ width }} className="max-w-full">
        <Story />
      </div>
    </QueryClientProvider>
  )
}
const seeded = (data: ReadSeed[]) => screenQueryClient({ data })

// --- Save as template -------------------------------------------------------

const experiment = {
  id: EXP_ID,
  workspace_id: '00000000-0000-4000-8000-00000000e700',
  identifier: 'EXP-0117',
  title: 'Harvest clarification',
}

export const SaveAsTemplate: Story = {
  render: () => (
    <SaveAsTemplateDialog
      open
      onOpenChange={() => {}}
      experiment={experiment}
    />
  ),
  decorators: [inside(seeded([]), 480)],
}

export const SaveAsTemplateBadKey: Story = {
  render: () => (
    <SaveAsTemplateDialog
      open
      onOpenChange={() => {}}
      experiment={{ ...experiment, title: '12 — Harvest' }}
    />
  ),
  decorators: [inside(seeded([]), 480)],
}

// --- Results board ----------------------------------------------------------

const TIME = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa01'
const TITRE = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa02'
const TRAIN = 'aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaa03'
const DATASET_ID = '11111111-1111-1111-8111-111111111111'

const source: CanonicalDatasetSource = {
  datasetId: DATASET_ID,
  name: 'Titre by train',
  workspaceId: '00000000-0000-4000-8000-00000000ffff',
  schemaVersionId: '00000000-0000-4000-8000-00000000fffe',
  schemaVersionNumber: 2,
  revision: 7,
  columns: [
    { id: TIME, label: 'Day', logicalType: 'decimal', unit: 'd' },
    { id: TITRE, label: 'Titre', logicalType: 'decimal', unit: 'g/L' },
    { id: TRAIN, label: 'Train', logicalType: 'category' },
  ],
}

const spec: ChartSpec = {
  specVersion: CHART_SPEC_VERSION,
  type: 'line',
  datasets: [{ datasetId: DATASET_ID }],
  fields: {
    x: { fieldId: TIME },
    y: { fieldId: TITRE },
    series: { fieldId: TRAIN },
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

const view: AnalysisViewWire = {
  id: 'view-1',
  workspace_id: '00000000-0000-4000-8000-00000000e700',
  owner_user_id: 'u-1',
  name: 'Titre over the run',
  display_id: 'AN-0012',
  version: 1,
  charts: [spec],
  source_revisions: [
    { datasetId: DATASET_ID, schemaVersionNumber: 2, revision: 7 },
  ],
  export_settings: null,
  created_at: '2026-10-20T09:00:00Z',
  updated_at: '2026-10-22T09:00:00Z',
}

const rows = ['A', 'B'].flatMap((train, t) =>
  [0, 3, 6, 9, 12].map((day, i) => ({
    [TIME]: day,
    [TITRE]: 0.4 + i * 0.9 + t * 0.3,
    [TRAIN]: train,
  })),
)

const decision = {
  label: 'Proceed to scale-up',
  notes: 'Titre met the 4 g/L target on both trains.',
  action: <Button size="sm">Change decision</Button>,
}

const resultsSeeds = (state: 'current' | 'stale'): ReadSeed[] => [
  {
    key: ['ui-port', 'results', 'dataset', view.id, view.version],
    value: {
      source,
      rows,
      truncated: false,
      totalCount: rows.length,
      flags: [],
    },
  },
  {
    key: analysisStudioQueryKeys.sourceStatus(view.id),
    value: {
      viewId: view.id,
      displayId: view.display_id,
      name: view.name,
      version: 1,
      state,
      staleCount: state === 'stale' ? 1 : 0,
      removedCount: 0,
      sources: [],
      citedByCount: 0,
      citedByLockedCount: 0,
    },
  },
  { key: ['user-names', ['u-1']], value: { 'u-1': 'Ada Okafor' } },
]

export const ResultsFigure: Story = {
  render: () => (
    <ResultsWorkspace expId={EXP_ID} views={[view]} decision={decision} />
  ),
  decorators: [withApiReads('error'), inside(seeded(resultsSeeds('current')))],
}

export const ResultsFigureStale: Story = {
  render: () => (
    <ResultsWorkspace expId={EXP_ID} views={[view]} decision={decision} />
  ),
  decorators: [withApiReads('error'), inside(seeded(resultsSeeds('stale')))],
}

export const ResultsSummaryTable: Story = {
  ...ResultsFigure,
  play: async () => {
    await userEvent.click(
      await screen.findByRole('button', { name: /Table 1/ }),
    )
    await expect(await screen.findByText('Rows')).toBeInTheDocument()
  },
}

export const ResultsDecisionOnly: Story = {
  render: () => (
    <ResultsWorkspace expId={EXP_ID} views={[]} decision={decision} />
  ),
  decorators: [withApiReads('error'), inside(seeded([]))],
}

// --- Saved trails -----------------------------------------------------------

export const TrailsSaved: Story = {
  render: () => <SavedTrails recordId={EXP_ID} />,
  decorators: [
    withApiReads('error'),
    inside(
      seeded([
        {
          key: ['ui-port', 'trail-evidence', EXP_ID],
          value: [
            {
              id: 'tr-1',
              record_id: EXP_ID,
              steps: [
                {
                  href: '/experiments/e1',
                  identifier: 'EXP-0117',
                  title: 'Harvest',
                },
                { href: '/datasets/d1', identifier: 'DS-0042', title: 'Titre' },
                {
                  href: '/analysis/a1',
                  identifier: null,
                  title: 'Titre over the run',
                },
              ],
              note: 'How the titre claim was reached',
              saved_by_user_id: 'u-1',
              created_at: '2026-11-02T09:00:00Z',
            },
          ],
        },
        { key: ['user-names', ['u-1']], value: { 'u-1': 'Ada Okafor' } },
      ]),
      760,
    ),
  ],
}

export const TrailsNone: Story = {
  render: () => (
    <div>
      <SavedTrails recordId={EXP_ID} />
      <p className="m-0 text-label text-fg-muted">
        With no saved trails the section renders nothing.
      </p>
    </div>
  ),
  decorators: [
    inside(
      seeded([{ key: ['ui-port', 'trail-evidence', EXP_ID], value: [] }]),
      760,
    ),
  ],
}
