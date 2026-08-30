import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { StatusBadge } from '#/components/sheetbase/status-badge'

const meta = { title: 'Scientific/Status badge', component: StatusBadge, tags: ['autodocs'], args: { status: 'in progress' } } satisfies Meta<typeof StatusBadge>
export default meta
type Story = StoryObj<typeof meta>
export const InProgress: Story = {}
export const Review: Story = { args: { status: 'review' } }
export const Approved: Story = { args: { status: 'approved' } }
export const Failed: Story = { args: { status: 'failed' } }
