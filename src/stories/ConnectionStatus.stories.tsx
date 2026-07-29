import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { ConnectionStatus } from '#/components/live/connection-status'

const meta = {
  title: 'Features/ConnectionStatus',
  component: ConnectionStatus,
  tags: ['autodocs'],
  args: { status: 'live', lastAppliedSeq: 142 },
} satisfies Meta<typeof ConnectionStatus>
export default meta
type Story = StoryObj<typeof meta>
export const Live: Story = {}
export const Connecting: Story = { args: { status: 'connecting' } }
export const Reconnecting: Story = { args: { status: 'reconnecting' } }
export const Offline: Story = { args: { status: 'offline' } }
