import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { FileType, getFileType } from '#/components/reui/file-type'

/**
 * File Type (`@reui/file-type`, adopted under ADR-0055 and restyled to the
 * app's tokens). One resolver and one glyph set replace the three icon
 * resolvers the domain surfaces had: `getFileType` reads a file name, a URL,
 * a bare extension or a MIME type, and `FileType` draws the page with the
 * format's label — so a surface can state the type instead of implying it.
 *
 * The restyle maps the item's per-format brand colours onto four semantic
 * families plus the neutral one; see the file header for the mapping and the
 * measured contrast of the label band in both themes.
 */
const meta = {
  title: 'UI/File Type',
  component: FileType,
  tags: ['autodocs'],
} satisfies Meta<typeof FileType>

export default meta
type Story = StoryObj<typeof meta>

export const Sizes: Story = {
  render: () => (
    <div className="flex items-end gap-4">
      {(['mini', 'xs', 'sm', 'default', 'lg', 'xl'] as const).map((size) => (
        <div key={size} className="flex flex-col items-center gap-2">
          <FileType type="pdf" size={size} />
          <span className="text-label text-fg-muted">{size}</span>
        </div>
      ))}
    </div>
  ),
}

export const Variants: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      {(['outline', 'solid', 'light', 'mono'] as const).map((variant) => (
        <div key={variant} className="flex flex-col items-center gap-2">
          <FileType type="xlsx" variant={variant} />
          <span className="text-label text-fg-muted">{variant}</span>
        </div>
      ))}
    </div>
  ),
}

export const Families: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-4">
      {[
        'protocol.pdf',
        'results.xlsx',
        'slides.pptx',
        'figure.png',
        'analysis.py',
        'archive.zip',
        'notes.txt',
        'payload.unknown',
      ].map((name) => (
        <div key={name} className="flex flex-col items-center gap-2">
          <FileType type={getFileType(name)} size="sm" />
          <span className="max-w-24 truncate text-label text-fg-muted">
            {name}
          </span>
        </div>
      ))}
    </div>
  ),
}

export const FileRows: Story = {
  render: () => (
    <ul className="max-w-md space-y-0.5">
      {[
        { id: '1', name: 'stability-run07.xlsx', size: '12.6 MB' },
        { id: '2', name: 'protocol-v3.pdf', size: '340 KB' },
        {
          id: '3',
          name: 'Monoclonal anti-β-actin clone AC-15, ascites fluid, working dilution 1:10,000 (image)',
          size: '1.4 GB',
        },
        { id: '4', name: 'payload', size: '512 B' },
      ].map((file) => (
        <li
          key={file.id}
          className="flex items-center gap-2 rounded-md px-1.5 py-1"
        >
          <FileType
            type={getFileType(file.name)}
            size="mini"
            className="shrink-0"
          />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-fg">
            {file.name}
          </span>
          <span className="shrink-0 text-[0.65rem] tabular-nums text-fg-muted">
            {file.size}
          </span>
        </li>
      ))}
    </ul>
  ),
}
