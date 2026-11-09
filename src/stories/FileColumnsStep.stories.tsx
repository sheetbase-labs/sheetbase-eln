import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { QueryClientProvider } from '@tanstack/react-query'

import { FileColumnsStep } from '#/components/import/file-columns-step'

import { screenQueryClient, screenRoutes } from './screen-stories'

/**
 * Import, step 1b: no table fits the file, so one is made from it. The columns
 * are read from the file's own preview, so the story hands the step a preview
 * and nothing is uploaded; creating the table is a write a story never sends.
 */
const client = screenQueryClient()

const sheet = {
  name: 'Plate 1',
  headers: ['Well', 'OD600 (AU)', 'Strain', 'Read at'],
  sampleRows: [
    {
      Well: 'A1',
      'OD600 (AU)': '0.412',
      Strain: 'WT',
      'Read at': '2026-10-04',
    },
    {
      Well: 'A2',
      'OD600 (AU)': '0.398',
      Strain: 'WT',
      'Read at': '2026-10-04',
    },
    {
      Well: 'B1',
      'OD600 (AU)': '0.655',
      Strain: 'ΔrecA',
      'Read at': '2026-10-04',
    },
  ],
  rowCount: 96,
  sheetNames: ['Plate 1'],
}

const meta = {
  title: 'Import/File columns step',
  component: FileColumnsStep,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    tanstack: {
      router: {
        route: screenRoutes('/import/$importId', ['/datasets']),
        path: '/import/file-1',
        params: { importId: 'file-1' },
      },
    },
  },
  args: {
    workspaceId: 'workspace',
    createdByUserId: 'user-1',
    fileId: 'file-1',
    filename: 'plate_reader_run-14.csv',
    initialSheet: sheet,
    projectId: null,
    onBack: () => {},
    onCreated: async () => {},
  },
  decorators: [
    (Story) => (
      <QueryClientProvider client={client}>
        <Story />
      </QueryClientProvider>
    ),
  ],
} satisfies Meta<typeof FileColumnsStep>

export default meta

type Story = StoryObj<typeof meta>

/** Names, types and units read from the file, ready to fix. */
export const Default: Story = {}

/** A workbook with several worksheets offers a worksheet picker. */
export const SeveralWorksheets: Story = {
  args: {
    initialSheet: { ...sheet, sheetNames: ['Plate 1', 'Plate 2', 'Notes'] },
  },
}
