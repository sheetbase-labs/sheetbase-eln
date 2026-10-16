import type { Meta, StoryObj } from '@storybook/tanstack-react'
import {
  Timeline,
  TimelineContent,
  TimelineDate,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
  TimelineTitle,
} from '#/components/reui/timeline'

/**
 * ReUI's `timeline` item, adopted at the pinned base-nova registry (ADR-0055)
 * and restyled to Sheetbase tokens. This story renders the parts as published:
 * the composition the registry's own examples use, with no history surface
 * around it. The shared history surface that consumes it is
 * `src/components/audit/history-timeline.tsx` (story: `Audit/History timeline`).
 */
const items = [
  {
    step: 1,
    date: '09:12',
    title: 'Experiment created',
    content: 'Ava Chen · experiment',
  },
  {
    step: 2,
    date: '11:48',
    title: 'Dataset attached',
    content: 'Marco Silva · results.csv',
  },
  {
    step: 3,
    date: '14:03',
    title: 'Review requested',
    content: 'Ava Chen · scientific review',
  },
]

const meta = { title: 'UI/Reui timeline', tags: ['autodocs'] } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Timeline value={0} className="m-0 max-w-md">
      {items.map((item) => (
        <TimelineItem key={item.step} step={item.step}>
          <TimelineHeader>
            <TimelineDate>{item.date}</TimelineDate>
            <TimelineTitle>{item.title}</TimelineTitle>
          </TimelineHeader>
          <TimelineIndicator />
          <TimelineSeparator />
          <TimelineContent>{item.content}</TimelineContent>
        </TimelineItem>
      ))}
    </Timeline>
  ),
}
