import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { RevisionDocumentReview } from '#/components/review/revision-document-review'
import {
  DOCUMENT_REVISION_ID,
  EARLIER_REVISION_ID,
  commentFixture,
  documentFixtures,
} from '#/lib/revision-document.test-fixtures'

/**
 * R5-NOTE-01 annotated revision document.
 *
 * The fixtures come from `#/lib/revision-document.test-fixtures`, the same
 * canonical frozen-revision envelopes the component's own tests render: a
 * before/after pair with an added block, a removed block and an inline text
 * change. Hand-writing those envelopes here would duplicate a shape the
 * product builds from the revision read.
 */
const { before, after } = documentFixtures()

const comments = [
  commentFixture({
    id: 'comment-1',
    body: 'Please state the harvest time explicitly.',
    author_user_id: 'reviewer-1',
  }),
  commentFixture({
    id: 'comment-2',
    root_id: 'comment-1',
    parent_id: 'comment-1',
    body: 'Added to the harvest block.',
    author_user_id: 'user-1',
  }),
]

const meta = {
  title: 'Review/Revision document',
  component: RevisionDocumentReview,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[860px] max-w-full">
        <Story />
      </div>
    ),
  ],
  args: {
    after,
    before,
    revisionId: DOCUMENT_REVISION_ID,
    comparisonRevisionId: EARLIER_REVISION_ID,
  },
} satisfies Meta<typeof RevisionDocumentReview>
export default meta
type Story = StoryObj<typeof meta>

/** Insertions and deletions marked against the previous revision. */
export const AgainstPreviousRevision: Story = {}

/** A first submission has nothing to mark against. */
export const FirstSubmission: Story = {
  args: { before: null, comparisonRevisionId: null, beforeLabel: undefined },
}

/** Anchored comments appear in the document margin. */
export const WithComments: Story = {
  args: { comments },
}

/** The document can start a comment on a block or a change. */
export const CommentingEnabled: Story = {
  args: {
    comments,
    onCommentTarget: () => {},
    onOpenComment: () => {},
    revisionLabels: new Map([
      [EARLIER_REVISION_ID, 'Revision 3'],
      [DOCUMENT_REVISION_ID, 'Revision 4'],
    ]),
  },
}

/** Deep-linking to a comment reveals it after the read returns. */
export const FocusedComment: Story = {
  args: { comments, focusCommentId: 'comment-1' },
}

/** Custom comparison labels for the gutter. */
export const CustomLabels: Story = {
  args: { beforeLabel: 'Returned revision', afterLabel: 'Resubmission' },
}
