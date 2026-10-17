import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { RequestEditAccessDialog } from '#/components/notebook/notebook-viewer-actions'

/**
 * The request-access dialog a viewer opens from the read-only bar. It is
 * controlled, so the wrapper owns `open`; submitting the request needs the
 * project, which the stories supply.
 */
function Harness({ initiallyOpen }: { initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(Boolean(initiallyOpen))
  const [requested, setRequested] = useState(false)
  return (
    <div className="space-y-2">
      {requested ? (
        <p className="text-xs text-fg-muted" role="status">
          Request sent to the project owner.
        </p>
      ) : null}
      <RequestEditAccessDialog
        open={open}
        onOpenChange={setOpen}
        projectId="0198d970-e266-4000-8000-0000000000b1"
        onRequested={() => {
          setRequested(true)
          setOpen(false)
        }}
      />
    </div>
  )
}

const meta = {
  title: 'Notebook/Request edit access dialog',
  component: RequestEditAccessDialog,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="p-6">
        <Story />
      </div>
    ),
  ],
  args: {
    open: false,
    onOpenChange: () => {},
    projectId: '0198d970-e266-4000-8000-0000000000b1',
    onRequested: () => {},
  },
} satisfies Meta<typeof RequestEditAccessDialog>
export default meta
type Story = StoryObj<typeof meta>

/** Closed: nothing is rendered until the viewer asks. */
export const Default: Story = { render: () => <Harness /> }

/** Open: the dialog explains what the request does. */
export const Open: Story = { render: () => <Harness initiallyOpen /> }
