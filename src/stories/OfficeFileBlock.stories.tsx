import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  FilePreview,
  OfficeFileBlock,
} from '#/components/notebook/office-preview/office-file-block'
import { fileVersionsKey } from '#/components/notebook/office-preview/use-file-versions'

import { holdRead, screenQueryClient } from './screen-stories'

/**
 * A file block for an Office file: version bar, preview and the actions. The
 * stored versions and the read preview are seeded, and the browser editor is
 * reported off, so the block draws its own preview and nothing is downloaded.
 */
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const versions = [
  {
    version: 1,
    displayName: 'plate-reader.xlsx',
    mediaType: XLSX,
    byteSize: 18_400,
    createdAt: '2026-10-18T09:00:00Z',
    status: 'active',
  },
  {
    version: 2,
    displayName: 'plate-reader.xlsx',
    mediaType: XLSX,
    byteSize: 19_900,
    createdAt: '2026-10-20T09:00:00Z',
    status: 'active',
  },
]

const preview = {
  kind: 'sheets',
  sheets: [
    {
      name: 'Plate 1',
      rows: [
        ['Well', 'OD600'],
        ['A1', '0.412'],
        ['A2', '0.398'],
      ],
      totalRows: 3,
      totalColumns: 2,
    },
  ],
}

function clientFor(pinned: number | null) {
  return screenQueryClient({
    data: [
      { key: fileVersionsKey('file-1'), value: versions },
      { key: ['office-editor', 'status', 'live'], value: false },
      {
        key: ['notebook', 'file-preview', 'file-1', pinned, 'inline'],
        value: preview,
      },
    ],
  })
}

const previewLoading = screenQueryClient()

holdRead(previewLoading, ['notebook', 'file-preview', 'file-9', null, 'inline'])

const latest = clientFor(null)
const pinnedOld = clientFor(1)

const payload = {
  fileRecordId: 'file-1',
  displayName: 'plate-reader.xlsx',
  mediaType: XLSX,
  byteSize: 19_900,
}

const meta = {
  title: 'Notebook/Office file block',
  component: OfficeFileBlock,
  tags: ['autodocs'],
  args: { payload, save: async () => ({ ok: true }) },
  decorators: [
    (Story, context) => (
      <QueryClientProvider
        client={
          context.parameters.client as ReturnType<typeof screenQueryClient>
        }
      >
        <div className="w-[720px] max-w-full">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
} satisfies Meta<typeof OfficeFileBlock>

export default meta

type Story = StoryObj<typeof meta>

/** Following the latest version of the file. */
export const Latest: Story = { parameters: { client: latest } }

/** Pinned to version 1 while version 2 exists: the bar offers the newer one. */
export const NewerVersionAvailable: Story = {
  parameters: { client: pinnedOld },
  args: { payload: { ...payload, fileVersion: 1 } },
}

/** A signed or locked notebook: nothing can be changed. */
export const ReadOnly: Story = {
  parameters: { client: latest },
  args: { readOnly: true },
}

/** The preview of one stored version on its own. */
export const Preview: Story = {
  parameters: { client: latest },
  render: () => (
    <FilePreview
      fileRecordId="file-1"
      version={null}
      kind="sheet"
      mediaType={XLSX}
      name="plate-reader.xlsx"
    />
  ),
}

/** A preview that is still being read. */
export const PreviewLoading: Story = {
  parameters: { client: previewLoading },
  render: () => (
    <FilePreview
      fileRecordId="file-9"
      version={null}
      kind="sheet"
      mediaType={XLSX}
      name="plate-reader.xlsx"
    />
  ),
}
