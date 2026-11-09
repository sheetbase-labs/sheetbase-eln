import { useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { expect, screen, userEvent } from 'storybook/test'
import type { RowSelectionState, SortingState } from '@tanstack/react-table'

import {
  AddEvidenceDialog,
  AddTextDialog,
} from '#/components/reports/add-section-dialogs'
import { GeneratedReports } from '#/components/reports/generated-reports'
import { NewReportDialog } from '#/components/reports/new-report-dialog'
import { ReportDocument } from '#/components/reports/report-document'
import { ReportsRegistryGrid } from '#/components/reports/reports-registry-grid'
import { SectionCard } from '#/components/reports/section-card'
import { reportKeys } from '#/lib/reports'
import type {
  ReportDetail,
  ReportGeneration,
  ReportListRow,
  ReportSection,
} from '#/lib/reports'
import { screenQueryClient, screenRoutes, withApiReads } from './screen-stories'
import type { ReadSeed } from './screen-stories'

/**
 * The report builder's parts (`src/components/reports/`): the registry
 * list, the report as a reader sees it, each section card, the two "add a
 * section" dialogs, the dialog that starts a report, and the documents
 * generated from one.
 */
const RECORD_ID = '00000000-0000-4000-8000-00000000e701'
const DEFINITION_ID = '00000000-0000-4000-8000-00000000e702'
const WORKSPACE_ID = '00000000-0000-4000-8000-00000000e700'

const meta = {
  title: 'Reports/Builder parts',
  parameters: {
    tanstack: {
      router: {
        route: screenRoutes('/reports/$reportId', [
          '/reports',
          '/experiments/$expId',
          '/projects/$projectId',
        ]),
        path: '/reports/$reportId',
        params: { reportId: RECORD_ID },
      },
    },
  },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

function inside(queryClient: QueryClient, width = 860) {
  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={queryClient}>
      <div style={{ width }} className="max-w-full">
        <Story />
      </div>
    </QueryClientProvider>
  )
}

const seeded = (data: ReadSeed[]) => screenQueryClient({ data })

const textSection: ReportSection = {
  id: 'sec-1',
  position: 1,
  title: 'Summary',
  description: 'Titre reached 4.2 g/L by day 10 in all four vessels.',
  sectionType: 'text',
  sourceType: 'free_text',
  sourceRevisionId: null,
  sourceRef: {},
  frozenPayload: {},
  validationStatus: 'valid',
  validationDetail: {},
}

const evidenceSection: ReportSection = {
  id: 'sec-2',
  position: 2,
  title: 'Run notes (EXP-0117)',
  description: null,
  sectionType: 'evidence',
  sourceType: 'notebook_block',
  sourceRevisionId: 'rev-1',
  sourceRef: { recordId: 'e-1', recordIdentifier: 'EXP-0117' },
  frozenPayload: {
    block: {
      id: 'blk-1',
      type: 'rich_text',
      payload: {
        doc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'Feed started at 48 h; no pH excursions recorded.',
                },
              ],
            },
          ],
        },
      },
    },
  },
  validationStatus: 'stale',
  validationDetail: {},
}

const report: ReportDetail = {
  definitionId: DEFINITION_ID,
  recordId: RECORD_ID,
  workspaceId: WORKSPACE_ID,
  projectId: 'p-1',
  projectTitle: 'Process Development',
  identifier: 'RPT-0004',
  title: 'Fed-batch titre summary',
  subtitle: 'Campaign 12',
  status: 'draft',
  version: 1,
  createdByUserId: 'u-1',
  createdAt: '2026-10-20T09:00:00Z',
  updatedAt: '2026-11-02T09:00:00Z',
  lockedAt: null,
  sections: [textSection, evidenceSection],
}

// --- Registry list ----------------------------------------------------------

const listRow = (n: number, over: Partial<ReportListRow>): ReportListRow => ({
  recordId: `rec-${n}`,
  definitionId: `def-${n}`,
  identifier: `RPT-000${n}`,
  title: 'Fed-batch titre summary',
  subtitle: null,
  status: 'draft',
  version: 1,
  projectId: 'p-1',
  projectTitle: 'Process Development',
  sectionCount: 3,
  lastGeneratedAt: null,
  createdByUserId: 'u-1',
  updatedAt: '2026-11-02T09:00:00Z',
  ...over,
})

function RegistryHarness({
  rows,
  isLoading = false,
}: {
  rows: ReportListRow[]
  isLoading?: boolean
}) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [selection, setSelection] = useState<RowSelectionState>({})

  return (
    <ReportsRegistryGrid
      rows={rows}
      ownerLabel={() => 'Ada Okafor'}
      isLoading={isLoading}
      sorting={sorting}
      onSortingChange={setSorting}
      rowSelection={selection}
      onRowSelectionChange={setSelection}
      onOpen={() => {}}
    />
  )
}

export const RegistryList: Story = {
  render: () => (
    <RegistryHarness
      rows={[
        listRow(4, {}),
        listRow(3, {
          title: 'Stability readout, 6 months',
          status: 'approved',
          version: 2,
          lastGeneratedAt: '2026-10-28T09:00:00Z',
        }),
        listRow(2, { title: 'Media screen', status: 'in_review' }),
        listRow(1, { title: 'Old campaign', status: 'archived' }),
      ]}
    />
  ),
  decorators: [inside(seeded([]), 1000)],
}

export const RegistryEmpty: Story = {
  render: () => <RegistryHarness rows={[]} />,
  decorators: [inside(seeded([]), 1000)],
}

export const RegistryLoading: Story = {
  render: () => <RegistryHarness rows={[]} isLoading />,
  decorators: [inside(seeded([]), 1000)],
}

// --- Document ---------------------------------------------------------------

export const Document: Story = {
  render: () => <ReportDocument report={report} />,
  decorators: [inside(seeded([]), 900)],
}

export const DocumentEmpty: Story = {
  render: () => <ReportDocument report={{ ...report, sections: [] }} />,
  decorators: [inside(seeded([]), 900)],
}

// --- Section cards ----------------------------------------------------------

const card = (section: ReportSection, locked = false) => (
  <SectionCard
    section={section}
    index={0}
    total={2}
    recordId={RECORD_ID}
    workspaceId={WORKSPACE_ID}
    locked={locked}
    onMove={() => {}}
  />
)

export const TextSection: Story = {
  render: () => card(textSection),
  decorators: [inside(seeded([]), 760)],
}

export const EvidenceSectionStale: Story = {
  render: () => card(evidenceSection),
  decorators: [inside(seeded([]), 760)],
}

export const SectionLocked: Story = {
  render: () => card({ ...evidenceSection, validationStatus: 'locked' }, true),
  decorators: [inside(seeded([]), 760)],
}

export const SectionMissingSource: Story = {
  render: () =>
    card({ ...evidenceSection, validationStatus: 'missing_source' }),
  decorators: [inside(seeded([]), 760)],
}

// --- Add a section ----------------------------------------------------------

export const AddText: Story = {
  render: () => (
    <AddTextDialog
      open
      onOpenChange={() => {}}
      recordId={RECORD_ID}
      definitionId={DEFINITION_ID}
      workspaceId={WORKSPACE_ID}
    />
  ),
  decorators: [inside(seeded([]))],
}

export const AddEvidence: Story = {
  render: () => (
    <AddEvidenceDialog
      open
      onOpenChange={() => {}}
      recordId={RECORD_ID}
      definitionId={DEFINITION_ID}
      workspaceId={WORKSPACE_ID}
      projectId="p-1"
    />
  ),
  decorators: [
    inside(
      seeded([
        {
          key: [...reportKeys.evidenceRevisions(RECORD_ID), 'records', 'p-1'],
          value: [
            {
              id: 'e-1',
              identifier: 'EXP-0117',
              title: 'Harvest clarification',
              kind: 'experiment',
            },
          ],
        },
      ]),
    ),
  ],
}

export const AddEvidenceLoadFailed: Story = {
  render: () => (
    <AddEvidenceDialog
      open
      onOpenChange={() => {}}
      recordId={RECORD_ID}
      definitionId={DEFINITION_ID}
      workspaceId={WORKSPACE_ID}
      projectId={null}
    />
  ),
  decorators: [withApiReads('error'), inside(seeded([]))],
}

// --- New report -------------------------------------------------------------

export const NewReport: Story = {
  render: () => <NewReportDialog workspaceId={WORKSPACE_ID} />,
  decorators: [
    withApiReads('error'),
    inside(
      seeded([
        {
          key: ['ui-port', 'writable-projects', 'projects'],
          value: [
            {
              id: 'p-1',
              title: 'Process Development',
              archived_at: null,
              status: 'active',
              display_id: 'PRJ-0001',
              stage: null,
              modality: null,
            },
          ],
        },
        {
          key: ['ui-port', 'writable-projects', 'access'],
          value: [{ project_id: 'p-1', can_edit: true, can_manage: true }],
        },
      ]),
      240,
    ),
  ],
  play: async () => {
    await userEvent.click(await screen.findByRole('button'))
    await expect(await screen.findByRole('dialog')).toBeInTheDocument()
  },
}

// --- Generated documents ----------------------------------------------------

const generations: ReportGeneration[] = [
  {
    id: 'gen-2',
    reportVersion: 2,
    outputFormat: 'html',
    checksum: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    sizeBytes: 48_200,
    actorUserId: 'u-1',
    generatedAt: '2026-10-28T09:00:00Z',
  },
  {
    id: 'gen-1',
    reportVersion: 1,
    outputFormat: 'html',
    checksum: '0f9e8d7c6b5a49382716f5e4d3c2b1a0',
    sizeBytes: 31_900,
    actorUserId: 'u-1',
    generatedAt: '2026-10-20T09:00:00Z',
  },
]

export const GeneratedList: Story = {
  render: () => (
    <GeneratedReports definitionId={DEFINITION_ID} identifier="RPT-0004" />
  ),
  decorators: [
    withApiReads('error'),
    inside(
      seeded([
        {
          key: reportKeys.generations(DEFINITION_ID),
          value: generations,
        },
        { key: ['user-names', ['u-1', 'u-1']], value: { 'u-1': 'Ada Okafor' } },
      ]),
    ),
  ],
}

export const GeneratedEmpty: Story = {
  render: () => (
    <GeneratedReports definitionId={DEFINITION_ID} identifier="RPT-0004" />
  ),
  decorators: [
    inside(seeded([{ key: reportKeys.generations(DEFINITION_ID), value: [] }])),
  ],
}
