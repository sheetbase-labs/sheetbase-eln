import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { AnalysisFigureGuide } from '#/components/assist/analysis-figure-guide'
import { GuidePanel } from '#/components/assist/guide-panel'
import { SubmissionReadinessGuide } from '#/components/assist/submission-readiness-guide'
import {
  evaluateAnalysisToFigure,
  evaluateSubmissionReadiness,
} from '#/lib/assist-guide'

/**
 * Step-aware guidance (ASSIST-03): the steps with their done, current and
 * blocked states, why a step is blocked, and next-action buttons that navigate
 * to or invoke the surface's own accept path. The panel never changes anything
 * itself. `SubmissionReadinessGuide` and `AnalysisFigureGuide` are the two
 * mounts that derive the workflow from live state.
 */
const SUBMISSION = {
  recordId: 'exp-1',
  hasUnsavedWork: false,
  archivedAt: null,
  lockedAt: null,
  activeReview: false,
  reviewerCount: 1,
  digest: null,
  digestPending: false,
  digestError: null,
  submissionId: null,
  decision: null,
}

const meta = {
  title: 'Assistant/Guide panel',
  component: GuidePanel,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    workflow: evaluateSubmissionReadiness(SUBMISSION),
    onAccept: () => {},
  },
  decorators: [
    (Story) => (
      <div className="w-[440px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof GuidePanel>

export default meta

type Story = StoryObj<typeof meta>

/** Ready to check the snapshot: the first open step offers its action. */
export const SubmissionReady: Story = {}

/** Unsaved work blocks the snapshot, with the reason shown. */
export const SubmissionBlocked: Story = {
  args: {
    workflow: evaluateSubmissionReadiness({
      ...SUBMISSION,
      hasUnsavedWork: true,
      reviewerCount: 0,
    }),
  },
}

export const Accepting: Story = { args: { accepting: true } }

/** The submission mount, wired to the submit dialog's own handlers. */
export const SubmissionMount: Story = {
  render: () => (
    <SubmissionReadinessGuide
      {...SUBMISSION}
      onCheckSnapshot={() => {}}
      onSubmitRevision={() => {}}
      onOpenReviews={() => {}}
    />
  ),
}

/** The analysis-to-figure workflow with no compare view configured yet. */
export const AnalysisNotConfigured: Story = {
  args: {
    workflow: evaluateAnalysisToFigure({
      datasetId: 'ds-1',
      columnCount: 5,
      rowCount: 120,
      compareConfigValid: false,
      chartSpecReady: false,
      embeddedBlockId: null,
    }),
  },
}

/** The analysis mount with a valid compare view, ready to propose a chart. */
export const AnalysisMount: Story = {
  render: () => (
    <AnalysisFigureGuide
      datasetId="ds-1"
      columnCount={5}
      rowCount={120}
      chartSpecReady={false}
      compareConfig={{
        configVersion: 1,
        datasetId: 'ds-1',
        versionId: null,
        viewType: 'distribution',
        timeField: null,
        valueField: 'titre',
        groupBy: ['condition'],
        facetBy: null,
      }}
      columns={[
        { id: 'titre', label: 'Titre', logicalType: 'decimal' },
        { id: 'condition', label: 'Condition', logicalType: 'text' },
      ]}
    />
  ),
}
