import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ImportProjectsDialog } from '#/components/projects/import-projects-dialog'
import { screenQueryClient } from './screen-stories'

/**
 * The Import projects dialog: pick a CSV, check each line, then import the
 * lines that matched. It is shown open and waiting for a file; the preview
 * appears once a file is chosen.
 */
const meta = {
  title: 'Projects/Import projects',
  component: ImportProjectsDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    open: true,
    onOpenChange: () => {},
    clientOptions: [{ id: 'c1', label: 'CL-017 · AAV Partners' }],
    memberOptions: [{ id: 'u1', label: 'Ada S.' }],
  },
  decorators: [
    (Story) => (
      <QueryClientProvider client={screenQueryClient()}>
        <Story />
      </QueryClientProvider>
    ),
  ],
} satisfies Meta<typeof ImportProjectsDialog>

export default meta

type Story = StoryObj<typeof meta>

/** Waiting for a CSV file. */
export const Default: Story = {}
