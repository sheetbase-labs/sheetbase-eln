import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { HistoryTimeline } from '#/components/audit/history-timeline'
import type { HistoryEntry } from '#/components/audit/history-timeline'

/**
 * The one history surface behind every audit and history panel. The rows below
 * are fixed data, not business data, so the story renders anywhere.
 */
const entries: HistoryEntry[] = [
  {
    id: '1',
    icon: 'flask',
    title: 'Experiment created',
    actor: 'Ava Chen',
    time: '09:12',
    sentence: 'Ava Chen experiment created at 09:12.',
  },
  {
    id: '2',
    icon: 'upload',
    title: 'Dataset attached',
    actor: 'Marco Silva',
    time: '2h ago',
    dateTime: '2026-10-16T09:14:00.000Z',
    detail: '16 Oct 2026, 09:14',
    changes: [
      {
        label: 'Status',
        kind: 'changed',
        from: 'draft',
        to: 'in review',
      },
      { label: 'Owner', kind: 'added', to: 'Ava Chen' },
      { label: 'Tag', kind: 'removed', from: 'pilot' },
    ],
    link: { href: '/records/EXP-0142', label: 'Open record' },
    raw: { operation: 'update', changes: { status: 'in review' } },
  },
  {
    id: '3',
    icon: 'archive',
    title: (
      <>
        <span className="font-medium">Quality review</span>
        <span className="text-fg-muted">archived</span>
      </>
    ),
    time: '3d ago',
    dateTime: '2026-10-13T09:14:00.000Z',
    detail: '13 Oct 2026, 09:14',
    related: [{ id: '3a', text: 'restored Record EXP-0142' }],
    raw: { operation: 'archive' },
  },
]

const meta = {
  title: 'Audit/History timeline',
  component: HistoryTimeline,
  tags: ['autodocs'],
  args: {
    entries,
    ariaLabel: 'Audit trail',
    emptyMessage: 'No activity yet',
  },
} satisfies Meta<typeof HistoryTimeline>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Loading: Story = { args: { loading: true } }

export const Empty: Story = { args: { entries: [] } }

export const Error: Story = {
  args: {
    entries: [],
    error: 'History is not available for this object.',
    retry: { onClick: () => {} },
  },
}

export const LoadMore: Story = {
  args: {
    loadMore: { onClick: () => {}, label: 'Load more (12 left)' },
    footer: 'Showing 3 of 15 events',
  },
}
