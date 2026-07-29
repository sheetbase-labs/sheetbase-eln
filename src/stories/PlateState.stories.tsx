import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { PlateState } from '#/components/instrument-monitor/plate-state'
import type { InstrumentPlateSnapshot } from '#/lib/instrument-monitor'

const snapshot: InstrumentPlateSnapshot = {
  id: 'snapshot',
  workspaceId: 'workspace',
  runId: 'run',
  observationId: null,
  plateFormat: '96',
  wells: {
    A1: 'amplified',
    A2: 'no_amplification',
    A3: 'blank',
    B1: { status: 'amplified' },
  },
  capturedAt: '2026-07-29T12:00:00Z',
  cycleNumber: 32,
  createdAt: '2026-07-29T12:00:00Z',
}
const meta = {
  title: 'Features/PlateState',
  component: PlateState,
  tags: ['autodocs'],
  args: { snapshots: [snapshot], runStatus: 'running' },
} satisfies Meta<typeof PlateState>
export default meta
type Story = StoryObj<typeof meta>
export const Running: Story = {}
export const Pending: Story = { args: { snapshots: [] } }
export const Cancelled: Story = { args: { runStatus: 'cancelled' } }
