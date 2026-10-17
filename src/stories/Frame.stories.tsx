import type { Meta, StoryObj } from '@storybook/tanstack-react'
import {
  Frame,
  FrameDescription,
  FrameFooter,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from '#/components/reui/frame'

/**
 * ReUI `frame` (ADR-0055), installed from the pinned base-nova registry and
 * placed at `src/components/reui/frame.tsx`. The stories render fixture text
 * only: no business data, no route.
 */
const meta = {
  title: 'UI/Frame',
  component: Frame,
  tags: ['autodocs'],
  args: {
    spacing: 'default',
    variant: 'default',
    stacked: false,
    dense: false,
  },
  argTypes: {
    spacing: {
      control: 'inline-radio',
      options: ['xs', 'sm', 'default', 'lg'],
    },
    variant: {
      control: 'inline-radio',
      options: ['default', 'inverse', 'ghost'],
    },
  },
} satisfies Meta<typeof Frame>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <Frame {...args} className="w-[520px]">
      <FramePanel>
        <FrameHeader>
          <FrameTitle>Virus stability at 4 °C</FrameTitle>
          <FrameDescription>Fixture panel. No record is read.</FrameDescription>
        </FrameHeader>
        <div className="px-4 py-3 text-body text-fg-muted">Panel body</div>
        <FrameFooter>
          <span className="text-label text-fg-muted">10 of 10 rows</span>
        </FrameFooter>
      </FramePanel>
    </Frame>
  ),
}

/** The non-default variant the adoption uses: a tighter frame around a grid. */
export const Tight: Story = { args: { spacing: 'sm' } }

/** Panels stacked flush, the variant a list of sections uses. */
export const Stacked: Story = {
  args: { stacked: true },
  render: (args) => (
    <Frame {...args} className="w-[520px]">
      <FramePanel>
        <FrameHeader>
          <FrameTitle>Section one</FrameTitle>
        </FrameHeader>
      </FramePanel>
      <FramePanel>
        <FrameHeader>
          <FrameTitle>Section two</FrameTitle>
        </FrameHeader>
      </FramePanel>
    </Frame>
  ),
}
