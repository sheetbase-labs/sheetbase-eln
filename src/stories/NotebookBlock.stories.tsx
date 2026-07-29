import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { NotebookBlock } from '#/components/notebook/notebook-block'
import { BlockPreview } from '#/components/notebook/block-preview'
const payloads: any = {
  rich_text: {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Cells were incubated at 37 °C for 24 hours.' },
        ],
      },
    ],
  },
  checklist: {
    items: [
      { id: '1', text: 'Calibrate pipette', checked: true },
      { id: '2', text: 'Prepare standards', checked: false },
    ],
  },
  callout: {
    tone: 'warning',
    title: 'Safety',
    body: 'Handle all plasma in a class II cabinet.',
  },
  metric: { label: 'Final concentration', value: 7.42, unit: 'ng/µL' },
  materials: { items: [] },
}
const meta = {
  title: 'Notebook/Notebook block',
  component: NotebookBlock,
  tags: ['autodocs'],
  args: {
    label: 'Rich text',
    title: 'Method',
    children: 'Cells were incubated at 37 °C for 24 hours.',
    draggable: true,
  },
} satisfies Meta<typeof NotebookBlock>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const Types: Story = {
  render: () => (
    <div className="divide-y rounded border">
      {Object.entries(payloads).map(([type, payload], i) => (
        <NotebookBlock
          key={type}
          label={type.replace('_', ' ')}
          title={type === 'metric' ? 'Result' : undefined}
          state={i === 1 ? 'selected' : 'default'}
          draggable
        >
          <BlockPreview
            block={{ id: type, type, payload, payloadSchemaVersion: 1 } as any}
          />
        </NotebookBlock>
      ))}
    </div>
  ),
}
export const States: Story = {
  render: () => (
    <div className="divide-y rounded border">
      {(
        [
          'default',
          'selected',
          'editing',
          'dragging',
          'invalid',
          'locked',
          'loading',
          'read-only',
        ] as const
      ).map((state) => (
        <NotebookBlock key={state} label="Text" title={state} state={state}>
          Scientific notebook content
        </NotebookBlock>
      ))}
    </div>
  ),
}
