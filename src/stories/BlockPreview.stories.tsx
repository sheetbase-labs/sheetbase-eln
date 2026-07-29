import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { BlockPreview } from '#/components/notebook/block-preview'
const block = (type: string, payload: unknown) =>
  ({ id: type, type, payload, payloadSchemaVersion: 1 }) as any
const meta = {
  title: 'Notebook/Block preview',
  component: BlockPreview,
  tags: ['autodocs'],
  args: {
    block: block('metric', {
      label: 'DNA concentration',
      value: 42.7,
      unit: 'ng/µL',
    }),
  },
} satisfies Meta<typeof BlockPreview>
export default meta
type Story = StoryObj<typeof meta>
export const Metric: Story = {}
export const Checklist: Story = {
  args: {
    block: block('checklist', {
      items: [
        { id: '1', text: 'Thaw samples on ice', checked: true },
        { id: '2', text: 'Run qPCR plate', checked: false },
      ],
    }),
  },
}
export const Callout: Story = {
  args: {
    block: block('callout', {
      text: 'Control wells remained below the detection threshold.',
      variant: 'info',
    }),
  },
}
export const Table: Story = {
  args: {
    block: block('table', {
      columns: ['Sample', 'Ct', 'Tm (°C)'],
      rows: [
        ['SMP-0142', 21.4, 78.2],
        ['SMP-0143', 22.1, 78.4],
      ],
    }),
  },
}
export const Unsupported: Story = {
  args: {
    block: block('future_analysis', { algorithm: 'spectral-v3', result: 0.98 }),
  },
}
