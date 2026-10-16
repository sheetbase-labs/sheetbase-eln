import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Banner, Notice } from '#/components/v3/ui/alert'
import { Button } from '#/components/v3/ui/button'

/**
 * The v3 Notice and Banner (DSYS). `Notice` is a local message beside what it
 * describes; `Banner` is the page-wide strip under the header. Both take a
 * tone, derive `role` from it (`alert` for `bad`, `status` otherwise), and
 * carry an icon, a title and an action slot.
 *
 * Six hand-rolled alert chromes on the app-3 bridge vocabulary were deleted in
 * favour of this pair; the boards below are the shapes those sites needed:
 * a load failure, a retryable history failure, a page strip, and the
 * block-conflict choice.
 */
const meta = {
  title: 'UI/v3 Notice and Banner',
  component: Notice,
  tags: ['autodocs'],
} satisfies Meta<typeof Notice>

export default meta
type Story = StoryObj<typeof meta>

export const Notices: Story = {
  render: () => (
    <div className="flex max-w-2xl flex-col gap-4">
      <div>
        <p className="text-label text-fg-muted">Info (role: none)</p>
        <Notice className="mt-2">
          Comments are locked until the revision is resubmitted.
        </Notice>
      </div>
      <div>
        <p className="text-label text-fg-muted">Warn (role: none)</p>
        <Notice className="mt-2" tone="warn">
          This Protocol is linked to two Datasets.
        </Notice>
      </div>
      <div>
        <p className="text-label text-fg-muted">
          Bad (role=&quot;alert&quot;), with a title and a retry
        </p>
        <Notice
          className="mt-2"
          tone="bad"
          title="Could not load the record history."
          action={
            <Button variant="secondary" size="sm">
              Try again
            </Button>
          }
        >
          Nothing was changed; the history panel is the only part that failed.
        </Notice>
      </div>
      <div>
        <p className="text-label text-fg-muted">
          Icon replaced, and no icon at all
        </p>
        <div className="mt-2 flex flex-col gap-2">
          <Notice tone="warn" icon="lock" title="View only">
            Editing needs editor access on this workspace.
          </Notice>
          <Notice icon={false}>A notice with no icon.</Notice>
        </div>
      </div>
    </div>
  ),
}

export const Banners: Story = {
  render: () => (
    <div className="flex flex-col gap-px overflow-hidden rounded-lg border">
      <Banner tone="info" title="Live stream reconnected.">
        Changes queued while offline are being applied.
      </Banner>
      <Banner tone="warn" title="You're offline.">
        Keep working: edits are saved on this device and sync when you
        reconnect.
      </Banner>
      <Banner tone="bad" title="Saving is paused.">
        The server rejected the last three writes.
      </Banner>
      <Banner tone="review" title="In review.">
        This revision is with the QA reviewer; edits are read-only.
      </Banner>
    </div>
  ),
}

export const ActionSlots: Story = {
  render: () => (
    <div className="flex max-w-2xl flex-col gap-4">
      <Notice
        tone="warn"
        title="Mapping not saved as this parser's default"
        action={
          <Button variant="quiet" size="sm">
            Save as default
          </Button>
        }
      >
        The column mapping applies to this import only.
      </Notice>
      <Banner
        tone="warn"
        title="You're offline."
        action={
          <>
            <span className="text-fg-muted">3 unsynced changes</span>
            <Button size="sm" variant="secondary">
              Retry now
            </Button>
          </>
        }
      >
        Keep working: edits are saved on this device.
      </Banner>
    </div>
  ),
}
