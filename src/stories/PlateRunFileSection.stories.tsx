import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { RunFileSection } from '#/components/plates/run-file-section'

/** The top of the new-run dialog: drop the reader's file, pick a plate of it. */
const meta = {
  title: 'Plates/Run file section',
  component: RunFileSection,
  tags: ['autodocs'],
  args: {
    file: null,
    candidateId: '',
    fileError: null,
    onFile: () => undefined,
    onCandidate: () => undefined,
  },
} satisfies Meta<typeof RunFileSection>

export default meta

type Story = StoryObj<typeof meta>

export const Empty: Story = {}

export const WithError: Story = {
  args: { fileError: 'That file has no plate in it.' },
}
