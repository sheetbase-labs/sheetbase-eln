import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { userEvent, within } from 'storybook/test'

import { MakeSheetFromFile } from '#/components/notebook/make-sheet-from-file'

import { holdRead, screenQueryClient } from './screen-stories'

/**
 * "Make a sheet" on an Excel or LibreOffice file block. The workbook is one
 * read keyed by file and version, which a story seeds, so nothing is
 * downloaded. The dialog is portalled; the stories open it the way a person does.
 */
const cell = (value: string | number) => ({ value })

const workbook = [
  {
    name: 'Plate 1',
    rows: [
      [cell('Well'), cell('OD600'), cell('Strain')],
      [cell('A1'), cell(0.412), cell('WT')],
      [cell('A2'), cell(0.398), cell('WT')],
      [cell('B1'), cell(0.655), cell('ΔrecA')],
      [cell('B2'), cell(0.671), cell('ΔrecA')],
    ],
  },
  {
    name: 'Notes',
    rows: [[cell('Note')], [cell('Reader calibrated 2026-10-01')]],
  },
]

const key = ['office-workbook', 'file-1', 2] as const
const ready = screenQueryClient({ data: [{ key, value: workbook }] })
const empty = screenQueryClient({ data: [{ key, value: [] }] })
const loading = screenQueryClient()

holdRead(loading, key)

const meta = {
  title: 'Notebook/Make sheet from file',
  component: MakeSheetFromFile,
  tags: ['autodocs'],
  args: {
    fileRecordId: 'file-1',
    fileVersion: 2,
    fileName: 'plate-reader.xlsx',
    mediaType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    onMake: async () => {},
  },
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
} satisfies Meta<typeof MakeSheetFromFile>

export default meta

type Story = StoryObj<typeof meta>

async function open(canvasElement: HTMLElement) {
  await userEvent.click(await within(canvasElement).findByRole('button'))
}

/** The action as it sits on the file block. */
export const Closed: Story = { parameters: { client: ready } }

/** Open on a workbook with two worksheets, with a preview of the first. */
export const Workbook: Story = {
  parameters: { client: ready },
  play: ({ canvasElement }) => open(canvasElement),
}

/** Open on a file with no worksheets. */
export const NoWorksheets: Story = {
  parameters: { client: empty },
  play: ({ canvasElement }) => open(canvasElement),
}

/** Open while the workbook is still being read. */
export const Loading: Story = {
  parameters: { client: loading },
  play: ({ canvasElement }) => open(canvasElement),
}
