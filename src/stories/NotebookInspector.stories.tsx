import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { NotebookInspector } from '#/components/notebook/notebook-inspector'

/**
 * The notebook's inspector column: Properties for the selected cell, plus
 * Comments and History tabs whose content the route supplies. It is a content
 * container, so stories pass fixture panels rather than mocked reads.
 */
const meta = {
  title: 'Notebook/Inspector',
  component: NotebookInspector,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="h-[520px] w-[320px] overflow-hidden rounded-lg border border-border">
        <Story />
      </div>
    ),
  ],
  args: {
    cell: {
      subject: 'Plate readings · row 6 · OD₆₀₀',
      value: { display: '0.34' },
      validation: {
        state: 'warning',
        headline: 'Above the expected range',
        detail: 'Expected 0.05 – 0.30 for this time point.',
        rule: 'OD range by time point',
      },
      provenance: {
        instrument: 'Plate reader 2',
        capturedAt: '29 Jul 2026, 09:41',
        enteredBy: 'Marco Silva',
      },
      column: {
        field: 'OD₆₀₀',
        type: 'Decimal',
        unit: 'AU',
        required: true,
        source: 'Bound to the plate-reader dataset',
      },
    },
    comments: (
      <p className="p-3 text-xs text-fg-muted">
        Block and row threads render here (CommentPanel / ThreadPanel).
      </p>
    ),
    history: (
      <p className="p-3 text-xs text-fg-muted">
        The record history renders here (NotebookHistoryPanel).
      </p>
    ),
    commentsCount: 3,
    historyCount: 12,
  },
} satisfies Meta<typeof NotebookInspector>
export default meta
type Story = StoryObj<typeof meta>

/** A selected cell with its validation warning and provenance. */
export const CellSelected: Story = {}

/** No selection: the Properties tab states that nothing is selected. */
export const NoSelection: Story = { args: { cell: null } }

/** Opening straight onto the comments tab. */
export const CommentsTab: Story = { args: { defaultTab: 'comments' } }

/** Opening straight onto the history tab. */
export const HistoryTab: Story = { args: { defaultTab: 'history' } }

/** Without counts the tab labels carry no badge. */
export const NoCounts: Story = {
  args: { commentsCount: undefined, historyCount: undefined },
}

/** A cell whose value could not be resolved says so rather than showing a
 * blank. */
export const UnresolvedValue: Story = {
  args: {
    cell: {
      subject: 'Plate readings · row 9 · OD₆₀₀',
      value: { display: null, note: 'The instrument export was unreadable.' },
    },
  },
}

/** Validation actions belong to the caller and ride above the tabs. */
export const WithActions: Story = {
  args: { actions: <p className="text-xs text-fg-muted">Value actions</p> },
}
