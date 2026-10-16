import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { SignatureRequestPreview } from '#/components/notebook/action-block-previews'
import { defaultPayloadFor } from '#/lib/blocks/registry'
import type { SignatureWire } from '#/lib/signatures'

/**
 * R5-NOTE-02 requested-signature block. The preview derives its state from
 * the payload and the revision's recorded signatures, so the stories vary
 * those two inputs the way the document does.
 */
function signature(overrides: Partial<SignatureWire> = {}): SignatureWire {
  return {
    id: 'sig-1',
    workspace_id: 'ws-1',
    submission_id: 'sub-1',
    revision_id: 'rev-1',
    record_id: 'record-1',
    signature_meaning: 'reviewed-and-approved',
    assurance_level: 'standard',
    revision_integrity_digest: 'a'.repeat(64),
    signer_user_id: 'u-1',
    signer_session_id: 's-1',
    signer_role: 'authenticated',
    auth_method: 'password',
    confirmation_phrase: 'Ada Lovelace',
    signed_at: '2026-10-11T10:00:00Z',
    created_at: '2026-10-11T10:00:00Z',
    signer_name: 'Ada Lovelace',
    ...overrides,
  }
}

const payload = {
  requestedUserId: 'u-1',
  requestedUserName: 'Ada Lovelace',
  meaning: 'reviewed-and-approved',
  note: 'Please review the runs before release.',
}

const meta = {
  title: 'Notebook/Signature request preview',
  component: SignatureRequestPreview,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[640px] max-w-full">
        <Story />
      </div>
    ),
  ],
  args: { payload, context: { revisionId: 'rev-1' } },
} satisfies Meta<typeof SignatureRequestPreview>
export default meta
type Story = StoryObj<typeof meta>

/** A signer is chosen, nothing is signed yet. */
export const Awaiting: Story = {}

/** The block a block-picker insertion leaves: no signer chosen. */
export const Unassigned: Story = {
  args: { payload: defaultPayloadFor('signature_request'), context: undefined },
}

/** A signature recorded against this revision settles the request. */
export const Signed: Story = {
  args: {
    context: {
      revisionId: 'rev-1',
      signatures: [signature()],
    },
  },
}

/** A signature recorded against a superseded revision does not. */
export const ChangedSinceSigned: Story = {
  args: {
    context: {
      revisionId: 'rev-2',
      signatures: [signature()],
    },
  },
}

/** In a superseded revision the request states that it moved on. */
export const Superseded: Story = {
  args: {
    context: {
      revisionId: 'rev-1',
      supersededByRevisionId: 'rev-2',
      signatures: [signature()],
    },
  },
}
