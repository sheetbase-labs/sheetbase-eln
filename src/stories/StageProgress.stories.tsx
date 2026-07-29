import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { StageProgress } from '#/components/instrument-monitor/stage-progress'
import type { InstrumentRunStage } from '#/lib/instrument-monitor'

const stage = (
  id: string,
  name: string,
  stageType: InstrumentRunStage['stageType'],
  status: InstrumentRunStage['status'],
  position: number,
): InstrumentRunStage => ({
  id,
  name,
  stageType,
  status,
  position,
  workspaceId: 'workspace',
  runId: 'run',
  cycleCount: stageType === 'cycling' ? 40 : null,
  currentCycle: stageType === 'cycling' ? 18 : 0,
  targetTemperature: 60,
  startedAt: null,
  completedAt: null,
  durationSeconds: 120,
  config: {},
  createdAt: '2026-07-29T00:00:00Z',
  updatedAt: '2026-07-29T00:00:00Z',
})
const stages = [
  stage('1', 'Initial hold', 'hold', 'completed', 0),
  stage('2', 'Amplification', 'cycling', 'running', 1),
  stage('3', 'Melt curve', 'melt', 'pending', 2),
]
const meta = {
  title: 'Features/StageProgress',
  component: StageProgress,
  tags: ['autodocs'],
  args: { stages },
} satisfies Meta<typeof StageProgress>
export default meta
type Story = StoryObj<typeof meta>
export const ActiveRun: Story = {}
export const Empty: Story = { args: { stages: [] } }
export const Completed: Story = {
  args: { stages: stages.map((item) => ({ ...item, status: 'completed' })) },
}
