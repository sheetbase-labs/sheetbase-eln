import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { SignatureDialog } from '#/components/review/sign-dialogs'
import type { RevisionWire } from '#/lib/notebook-data'

/**
 * R5-NOTE-02 signing entry point — a thin wrapper over the shared
 * `ESignDialog`, so the meaning, confirmation and password fields below are
 * the real signing surface. `open` is controlled by the caller, hence the
 * small stateful wrapper; the trigger opens the dialog.
 */
const revision: RevisionWire = {
  id: '0198d970-e266-4000-8000-000000000071',
  workspace_id: '0198d970-e266-4000-8000-00000000ffff',
  record_id: '0198d970-e266-4000-8000-0000000000a1',
  structure_version: 4,
  metadata_version: 2,
  metadata_snapshot: { title: 'Virus stability at 4 °C' },
  block_snapshot: [],
  reason: 'Submitted for scientific review',
  superseded_by_revision_id: null,
  created_at: '2026-07-29T14:03:00Z',
  created_by_user_id: 'user-1',
}

function Harness({ initiallyOpen }: { initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(Boolean(initiallyOpen))
  return (
    <SignatureDialog
      open={open}
      onOpenChange={setOpen}
      revision={revision}
      integrityDigest="4c9620bbd4f931955d4d42820a77fa9d"
      meanings={['reviewed', 'reviewed-and-approved', 'witnessed']}
      currentUserName="Ava Chen"
      signing={false}
      error={null}
      onConfirm={() => setOpen(false)}
    />
  )
}

const meta = {
  title: 'Review/Signature dialog',
  component: SignatureDialog,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[360px]">
        <Story />
      </div>
    ),
  ],
  args: {
    open: false,
    onOpenChange: () => {},
    revision,
    integrityDigest: '4c9620bbd4f931955d4d42820a77fa9d',
    meanings: ['reviewed', 'reviewed-and-approved', 'witnessed'],
    currentUserName: 'Ava Chen',
    signing: false,
    error: null,
    onConfirm: () => {},
  },
} satisfies Meta<typeof SignatureDialog>
export default meta
type Story = StoryObj<typeof meta>

/** The panel's trigger; clicking it opens the signing dialog. */
export const Default: Story = {
  render: () => <Harness />,
}

/** Opened, with the meaning, confirmation phrase and password fields. */
export const Open: Story = {
  render: () => <Harness initiallyOpen />,
}

/** A caller-requested meaning pre-selects that radio. */
export const RequestedMeaning: Story = {
  args: { requestedMeaning: 'witnessed' },
  render: () => <Harness initiallyOpen />,
}

/** The write in flight: the dialog reports it rather than closing. */
export const Signing: Story = {
  args: { signing: true, open: true },
  render: () => <Harness initiallyOpen />,
}

/** A refusal from the server is shown with the fields still filled. */
export const Error: Story = {
  args: {
    open: true,
    error: 'The password does not match the signed-in account.',
  },
  render: () => <Harness initiallyOpen />,
}
