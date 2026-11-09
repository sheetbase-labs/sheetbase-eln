import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ExportMenu } from '#/components/export/export-menu'

/**
 * The export dropdown. Choosing a format navigates a hidden frame to the export
 * endpoint, which a story never does; the stories show the menu's choices.
 */
const meta = {
  title: 'Data/Export menu',
  component: ExportMenu,
  tags: ['autodocs'],
  args: { path: '/api/export/dataset/dataset-1' },
} satisfies Meta<typeof ExportMenu>

export default meta

type Story = StoryObj<typeof meta>

/** Every tabular format. */
export const Default: Story = {}

/** Restricted to the formats the caller offers, with an evidence package. */
export const WithExtraItems: Story = {
  args: {
    formats: [
      { format: 'csv', label: 'CSV' },
      { format: 'xlsx', label: 'Excel workbook' },
    ],
    extraItems: [{ format: 'evidence', label: 'Evidence package' }],
    label: 'Download',
  },
}
