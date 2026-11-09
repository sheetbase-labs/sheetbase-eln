import { QueryClientProvider } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { expect, screen, userEvent } from 'storybook/test'

import {
  ProjectSheets,
  projectSheetsKey,
} from '#/components/projects/project-sheets'
import { BulkUpgradePanel } from '#/components/templates/bulk-upgrade-panel'
import { TemplateSectionsBoard } from '#/components/templates/template-sections-board'
import { templateDataQueryKeys } from '#/components/templates/templates-data'
import { UseTemplateDialog } from '#/components/templates/use-template-dialog'
import { parseNotebookTemplateConfiguration } from '#/lib/notebook-template'
import type { NotebookTemplateVersion } from '#/lib/notebook-template-data'
import type { SheetInstance } from '#/lib/sheet-instance-data'
import type { SheetInstanceState } from '#/lib/sheet-instance'
import { screenQueryClient, screenRoutes, withApiReads } from './screen-stories'
import type { ReadSeed } from './screen-stories'

/**
 * Template screens' parts (`src/components/templates/`) and the project's
 * Sheets tab (`src/components/projects/project-sheets`): taking a new
 * template version into notebooks already made, the sections board of a
 * template version, starting a notebook from a template, and the working
 * sheets of a project.
 */
const TEMPLATE_ID = '0198d970-e266-4000-8000-000000000f01'
const PROJECT_ID = '0198d970-e266-4000-8000-000000000009'

const uuid = (n: number) =>
  `0198d970-e266-4000-8000-0000000000${String(n).padStart(2, '0')}`

const meta = {
  title: 'Templates/Parts',
  parameters: {
    tanstack: {
      router: {
        route: screenRoutes('/templates/$templateId', [
          '/templates/$templateId/update',
          '/experiments/$expId',
          '/experiments/$expId/notebook',
          '/projects/$projectId',
          '/sheets/$sheetId',
        ]),
        path: '/templates/$templateId',
        params: { templateId: TEMPLATE_ID },
      },
    },
  },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

function inside(queryClient: QueryClient, width = 900) {
  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={queryClient}>
      <div style={{ width }} className="max-w-full">
        <Story />
      </div>
    </QueryClientProvider>
  )
}

const seeded = (data: ReadSeed[]) => screenQueryClient({ data })

const config = (parameters: unknown[], withProtocol = true) =>
  parseNotebookTemplateConfiguration({
    formatVersion: 1,
    parameters,
    placements: [
      {
        id: uuid(11),
        kind: 'narrative',
        order: 1,
        blockType: 'rich_text',
        payload: {},
      },
      ...(withProtocol
        ? [
            {
              id: uuid(12),
              kind: 'narrative',
              order: 2,
              blockType: 'protocol_reference',
              payload: { protocol: 'PRO-0007', version: 2 },
            },
          ]
        : []),
      {
        id: uuid(13),
        kind: 'section_placeholder',
        order: 3,
        key: 'observations',
        label: 'Observations',
      },
    ],
  })

const batchParameter = {
  id: uuid(21),
  key: 'batch_number',
  label: 'Batch number',
  required: true,
  type: { kind: 'scalar', valueType: 'text' },
  constraints: {},
}

const version = (
  n: number,
  lifecycle: NotebookTemplateVersion['lifecycle'],
  withParameter = false,
): NotebookTemplateVersion => ({
  id: uuid(30 + n),
  templateId: TEMPLATE_ID,
  version: n,
  lifecycle,
  configuration: config(withParameter ? [batchParameter] : [], n > 1),
  revision: 1,
  publishedAt: lifecycle === 'published' ? '2026-10-12T09:00:00Z' : null,
  publishedByUserId: lifecycle === 'published' ? 'u-1' : null,
  reason: null,
  signedByUserId: null,
  signedMeaning: null,
  signedAt: null,
  retiredAt: null,
  createdAt: '2026-10-10T09:00:00Z',
  updatedAt: '2026-10-11T14:20:00Z',
  updatedByUserId: 'u-1',
})

const v1 = version(1, 'published')
const v2 = version(2, 'draft')
const v3 = version(3, 'published', true)

// --- Bulk upgrade -----------------------------------------------------------

const notebooks = [
  { id: 'n-1', identifier: 'EXP-0101', locked_at: null },
  { id: 'n-2', identifier: 'EXP-0108', locked_at: null },
  { id: 'n-3', identifier: 'EXP-0112', locked_at: '2026-10-30T09:00:00Z' },
]

export const BulkUpgrade: Story = {
  render: () => (
    <BulkUpgradePanel
      templateId={TEMPLATE_ID}
      targetVersion={3}
      targetVersionId={v3.id}
      notebooks={notebooks}
    />
  ),
  decorators: [withApiReads('error'), inside(seeded([]), 760)],
}

export const BulkUpgradeResults: Story = {
  ...BulkUpgrade,
  play: async () => {
    // Nothing reaches the server in a story, so every notebook comes back in
    // the "left alone" list with the reason it gives.
    await userEvent.click(
      await screen.findByRole('button', { name: /Update all/ }),
    )
    await expect(
      await screen.findByRole(
        'list',
        { name: /not updated/i },
        { timeout: 8000 },
      ),
    ).toBeInTheDocument()
  },
}

export const BulkUpgradeNothingToDo: Story = {
  render: () => (
    <BulkUpgradePanel
      templateId={TEMPLATE_ID}
      targetVersion={3}
      targetVersionId={v3.id}
      notebooks={[]}
    />
  ),
  decorators: [inside(seeded([]), 760)],
}

// --- Sections board ---------------------------------------------------------

const boardUsers = (versions: NotebookTemplateVersion[]): ReadSeed => {
  const ids = versions.map((v) => v.id)

  return {
    key: [...templateDataQueryKeys.users(ids.join(',')), ids],
    value: [
      {
        id: 'n-1',
        identifier: 'EXP-0101',
        title: 'Run 1',
        source_notebook_template_version_id: v1.id,
      },
    ],
  }
}

const adaName: ReadSeed = {
  key: ['user-names', ['u-1', 'u-1']],
  value: { 'u-1': 'Ada Okafor' },
}

export const SectionsBoardDraft: Story = {
  render: () => (
    <TemplateSectionsBoard
      templateId={TEMPLATE_ID}
      templateKey="harvest_run"
      displayId="TPL-0003"
      version={v2}
      versions={[v1, v2]}
      onEditSections={() => {}}
    />
  ),
  decorators: [
    withApiReads('error'),
    inside(seeded([boardUsers([v1, v2]), adaName]), 1100),
  ],
}

export const SectionsBoardPublished: Story = {
  render: () => (
    <TemplateSectionsBoard
      templateId={TEMPLATE_ID}
      templateKey="harvest_run"
      displayId="TPL-0003"
      version={v3}
      versions={[v1, v3]}
      onEditSections={() => {}}
    />
  ),
  decorators: [
    withApiReads('error'),
    inside(seeded([boardUsers([v1, v3]), adaName]), 1100),
  ],
}

// --- Use a template ---------------------------------------------------------

const useSeeds: ReadSeed[] = [
  {
    key: ['ui-port', 'templates', 'use', 'projects'],
    value: [
      {
        id: PROJECT_ID,
        title: 'Process Development',
        archived_at: null,
        status: 'active',
      },
    ],
  },
  {
    key: ['ui-port', 'templates', 'use', 'project-access'],
    value: [{ project_id: PROJECT_ID, can_edit: true, can_manage: true }],
  },
]

export const UseTemplate: Story = {
  render: () => <UseTemplateDialog templateName="Harvest run" version={v3} />,
  decorators: [withApiReads('error'), inside(seeded(useSeeds), 240)],
  play: async () => {
    await userEvent.click(await screen.findByRole('button'))
    await expect(await screen.findByRole('dialog')).toBeInTheDocument()
  },
}

export const UseTemplateNoPublishedVersion: Story = {
  render: () => <UseTemplateDialog templateName="Harvest run" version={null} />,
  decorators: [inside(seeded(useSeeds), 240)],
}

// --- Project sheets ---------------------------------------------------------

const sheet = (
  n: number,
  over: Partial<SheetInstance> = {},
): SheetInstance => ({
  id: `sheet-${n}`,
  workspaceId: '00000000-0000-4000-8000-00000000e700',
  projectId: PROJECT_ID,
  notebookRecordId: null,
  sourceDefinitionVersionId: null,
  displayId: `SHT-000${n}`,
  name: 'Titre working sheet',
  description: null,
  lifecycle: 'active',
  revision: 1,
  state: {
    bindings: [],
    localFields: [],
    localValues: {},
    calculationOverrides: {},
  } as unknown as SheetInstanceState,
  duplicatedFromInstanceId: null,
  createdAt: '2026-10-10T09:00:00Z',
  updatedAt: '2026-11-01T09:00:00Z',
  createdByUserId: 'u-1',
  updatedByUserId: 'u-1',
  ...over,
})

export const ProjectSheetsList: Story = {
  render: () => <ProjectSheets projectId={PROJECT_ID} />,
  decorators: [
    withApiReads('error'),
    inside(
      seeded([
        {
          key: projectSheetsKey(PROJECT_ID, false),
          value: [
            sheet(3),
            sheet(2, {
              name: 'Media screen — copy',
              duplicatedFromInstanceId: 'sheet-1',
            }),
            sheet(1, {
              name: 'Plate layout',
              sourceDefinitionVersionId: uuid(40),
            }),
          ],
        },
      ]),
      1000,
    ),
  ],
}

export const ProjectSheetsEmpty: Story = {
  render: () => <ProjectSheets projectId={PROJECT_ID} />,
  decorators: [
    withApiReads('error'),
    inside(
      seeded([{ key: projectSheetsKey(PROJECT_ID, false), value: [] }]),
      1000,
    ),
  ],
}

export const ProjectSheetsFailed: Story = {
  render: () => <ProjectSheets projectId={PROJECT_ID} />,
  decorators: [
    withApiReads('error'),
    inside(screenQueryClient({ read: 'error' }), 1000),
  ],
}
