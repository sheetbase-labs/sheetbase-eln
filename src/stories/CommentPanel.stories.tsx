import type { Meta, StoryObj } from '@storybook/tanstack-react'
import { CommentThread } from '#/components/comments/comment-thread'
const root: any = {
  id: 'c1',
  revision_id: 'rev1',
  parent_comment_id: null,
  author_user_id: 'reviewer',
  body: 'The reported concentration is 42.7 ng/µL, but the source table shows 41.9. Please reconcile.',
  target_kind: 'block',
  target: { blockId: 'Results' },
  created_at: '2026-07-29T10:00:00Z',
}
const replies: any[] = [
  {
    ...root,
    id: 'c2',
    parent_comment_id: 'c1',
    author_user_id: 'me',
    body: 'Updated to the calibrated value and added the dilution factor.',
    created_at: '2026-07-29T11:00:00Z',
  },
]
const meta = {
  title: 'Comments/Comment panel',
  component: CommentThread,
  tags: ['autodocs'],
  args: {
    root,
    replies,
    resolved: false,
    currentUserId: 'me',
    currentUserName: 'Ava Chen',
    canComment: true,
    onReply: async () => {},
    onResolve: async () => {},
    onReopen: async () => {},
  },
} satisfies Meta<typeof CommentThread>
export default meta
type Story = StoryObj<typeof meta>
export const OpenThread: Story = {}
export const Resolved: Story = { args: { resolved: true } }
export const ReadOnly: Story = { args: { canComment: false } }
export const NoReplies: Story = { args: { replies: [] } }
