import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { FileList } from '#/components/record/inspector-sections'
import type { FileItem } from '#/components/record/inspector-sections'

/** One row per media type the icon picker distinguishes. */
const items: FileItem[] = [
  {
    id: 'f1',
    name: 'qPCR-plate-1.csv',
    size: '18.4 kB',
    mediaType: 'text/csv',
    href: '/files/file-1',
  },
  {
    id: 'f2',
    name: 'Instrument report.pdf',
    size: '1.2 MB',
    mediaType: 'application/pdf',
    href: '/files/file-2',
  },
  {
    id: 'f3',
    name: 'Plate layout.png',
    size: '420 kB',
    mediaType: 'image/png',
  },
  {
    id: 'f4',
    name: 'Run notes.txt',
    size: '2.1 kB',
    mediaType: 'text/plain',
  },
]

const meta = {
  title: 'Record/Inspector sections/File list',
  component: FileList,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
  args: { items },
} satisfies Meta<typeof FileList>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Empty: Story = { args: { items: [] } }

/** A row without a size or a media type still renders, with the fallback icon. */
export const SparseMetadata: Story = {
  args: { items: [{ id: 'f5', name: 'Attachment' }] },
}

/** Long file names truncate; the size stays right-aligned. */
export const LongName: Story = {
  args: {
    items: [
      {
        id: 'f6',
        name: '2026-07-29-virus-stability-4C-qPCR-plate-1-instrument-export-final.csv',
        size: '18.4 kB',
        mediaType: 'text/csv',
        href: '/files/file-6',
      },
    ],
  },
}
