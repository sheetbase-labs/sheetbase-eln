import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { SignaturesTable } from '#/components/review/signatures-table'
import type { SignatureWire } from '#/lib/signatures'

/**
 * The signature list for a record's revisions. Fixtures are wire rows, and
 * the settled versions are supplied through `revisionVersions` — a revision
 * absent from that map is never given a guessed version in the binding note.
 */
function signature(overrides: Partial<SignatureWire> = {}): SignatureWire {
  return {
    id: 'sig-1',
    workspace_id: 'workspace-1',
    submission_id: 'sub-1',
    revision_id: 'rev-1',
    record_id: 'record-1',
    signature_meaning: 'authored',
    assurance_level: 'standard',
    revision_integrity_digest: '4c9620bbd4f931955d4d42820a77fa9d',
    signer_user_id: 'user-1',
    signer_session_id: 'session-1',
    signer_role: 'member',
    auth_method: 'password',
    confirmation_phrase: 'I confirm this record is accurate',
    signed_at: '2026-07-29T14:05:00Z',
    created_at: '2026-07-29T14:05:00Z',
    signer_name: 'Ava Chen',
    ...overrides,
  }
}

const signatures: SignatureWire[] = [
  signature(),
  signature({
    id: 'sig-2',
    revision_id: 'rev-2',
    signature_meaning: 'reviewed',
    assurance_level: 'standard',
    signer_user_id: 'user-2',
    signer_role: 'reviewer',
    signed_at: '2026-07-30T09:12:00Z',
    created_at: '2026-07-30T09:12:00Z',
    signer_name: 'Priya Raman',
  }),
  signature({
    id: 'sig-3',
    revision_id: 'rev-2',
    signature_meaning: 'witnessed',
    signer_user_id: 'user-3',
    signer_name: 'Marco Silva',
    signed_at: '2026-07-30T09:40:00Z',
    created_at: '2026-07-30T09:40:00Z',
  }),
]

const revisionVersions = { 'rev-1': 3, 'rev-2': 4 }

const meta = {
  title: 'Review/Signatures table',
  component: SignaturesTable,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[820px] max-w-full">
        <Story />
      </div>
    ),
  ],
  args: { signatures, revisionVersions },
} satisfies Meta<typeof SignaturesTable>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** A load in flight must not read as “no signatures”. */
export const Loading: Story = { args: { isLoading: true } }

/** A failed load is reported as a failure, never as an empty table. */
export const ReadError: Story = { args: { isError: true } }

export const None: Story = { args: { signatures: [] } }

/** Without settled versions the binding note names no version. */
export const UnknownRevisionVersions: Story = {
  args: { revisionVersions: undefined },
}

/** Historical evidence with no recorded signer name states that. */
export const HistoricalSigner: Story = {
  args: {
    signatures: [
      signature({
        signer_name: null,
        signature_meaning: 'approve-for-record',
        signed_at: '2025-11-02T08:00:00Z',
        created_at: '2025-11-02T08:00:00Z',
      }),
    ],
  },
}
