import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { SaveStatus } from '#/components/notebook/save-status'

const meta = {
  title: 'Features/SaveStatus',
  component: SaveStatus,
  tags: ['autodocs'],
  args: { status: 'clean' },
} satisfies Meta<typeof SaveStatus>
export default meta
type Story = StoryObj<typeof meta>
export const Saved: Story = {}
export const Saving: Story = { args: { status: 'saving' } }
export const Offline: Story = { args: { status: 'offline' } }
export const Failed: Story = {
  args: { status: 'failed', message: 'Could not save this block.' },
}
