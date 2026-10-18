import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { ToggleGroup, ToggleGroupItem } from '#/components/reui/toggle-group'

/**
 * The stock shadcn `toggle-group` item, the candidate for comparison pair
 * `pressed-chips`. Not a ReUI item: the pinned registry answers 404 and says it
 * is shadcn's.
 *
 * Row 17 of `docs/knowledge/design/component-comparison-record.md` declined it.
 * Two things are visible in the stories below and are the reason: the group
 * announces `role="toolbar"` where the shipped chip row announces
 * `role="group"`, and it puts one tab stop on the container and forwards focus
 * to the first chip, so a multi-select group has no roving focus per chip.
 */
const meta = {
  title: 'UI/Registry toggle group',
  component: ToggleGroup,
  tags: ['autodocs'],
  args: { type: 'single' },
} satisfies Meta<typeof ToggleGroup>
export default meta
type Story = StoryObj<typeof meta>

const KINDS = ['Experiment', 'Dataset', 'Sample', 'Instrument']

/** Single selection: one kind at a time. */
export const Single: Story = {
  render: () => (
    <ToggleGroup type="single" defaultValue="dataset" aria-label="Kind">
      {KINDS.map((kind) => (
        <ToggleGroupItem key={kind} value={kind} className="text-label">
          {kind}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  ),
}

/** Multiple selection, which is the job the shipped chips do. */
export const Multiple: Story = {
  render: () => (
    <ToggleGroup
      type="multiple"
      defaultValue={['ok', 'warn']}
      aria-label="Status"
    >
      {['ok', 'review', 'warn', 'bad'].map((tone) => (
        <ToggleGroupItem
          key={tone}
          value={tone}
          size="sm"
          className="text-label"
        >
          {tone}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  ),
}

/** Outline, at the three sizes the underlying `toggle` publishes. */
export const OutlineAndSizes: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-3">
      {(['sm', 'default', 'lg'] as const).map((size) => (
        <ToggleGroup
          key={size}
          type="single"
          variant="outline"
          size={size}
          defaultValue="b"
          aria-label={`Segmented control, ${size}`}
        >
          <ToggleGroupItem value="a">Left</ToggleGroupItem>
          <ToggleGroupItem value="b">Middle</ToggleGroupItem>
          <ToggleGroupItem value="c">Right</ToggleGroupItem>
        </ToggleGroup>
      ))}
    </div>
  ),
}

/** A disabled group, for a filter that is not available in this deployment. */
export const Disabled: Story = {
  render: () => (
    <ToggleGroup type="multiple" disabled aria-label="Status">
      {['ok', 'review'].map((tone) => (
        <ToggleGroupItem key={tone} value={tone} className="text-label">
          {tone}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  ),
}
