import { QueryClientProvider } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import {
  EvidenceDrift,
  EvidenceSignatures,
} from '#/components/review/evidence-inspector'
import { revisionEvidenceQueryKeys } from '#/lib/revision-evidence'
import { signatureQueryKeys } from '#/lib/signatures'

import { auditVerificationKeys } from '#/lib/audit-verification-status'

import { holdRead, screenQueryClient } from './screen-stories'

/**
 * The review inspector's evidence sections: who signed the revision, and what
 * has moved since. Both are single reads, which a story seeds.
 */
const RECORD_ID = 'record-1'
const REVISION_ID = 'revision-1'

const signature = {
  id: 'sig-1',
  workspace_id: 'workspace',
  submission_id: 'submission-1',
  revision_id: REVISION_ID,
  record_id: RECORD_ID,
  signature_meaning: 'reviewed-and-approved',
  assurance_level: 'standard',
  revision_integrity_digest: 'abc123',
  signer_user_id: 'user-2',
  signer_session_id: 's2',
  signer_role: 'reviewer',
  auth_method: 'session+name-confirmation',
  confirmation_phrase: 'Priya Shah',
  signed_at: '2026-10-21T10:00:00Z',
  created_at: '2026-10-21T10:00:00Z',
  signer_name: 'Priya Shah',
}

const drift = {
  revisionId: REVISION_ID,
  recordId: RECORD_ID,
  signedAt: '2026-10-21T10:00:00Z',
  record: {
    recordId: RECORD_ID,
    identifier: 'EXP-0042',
    signedTitle: 'Growth assay',
    currentTitle: 'Growth assay (repeat)',
    renamed: true,
  },
  datasets: [
    {
      datasetId: 'dataset-1',
      citedVersionId: 'v1',
      citedLabel: 'Run 14',
      latestVersionId: 'v2',
      latestLabel: 'Run 14 (corrected)',
      changed: true,
    },
  ],
  instruments: [],
  commentsAfterSigning: 2,
  drifted: true,
}

const signed = screenQueryClient({
  data: [
    { key: auditVerificationKeys.status, value: null },
    { key: signatureQueryKeys.forRecord(RECORD_ID), value: [signature] },
    {
      key: revisionEvidenceQueryKeys.drift(REVISION_ID),
      value: {
        ...drift,
        drifted: false,
        record: { ...drift.record, renamed: false },
        datasets: [],
        commentsAfterSigning: 0,
      },
    },
  ],
})

const moved = screenQueryClient({
  data: [
    { key: auditVerificationKeys.status, value: null },
    { key: signatureQueryKeys.forRecord(RECORD_ID), value: [] },
    { key: revisionEvidenceQueryKeys.drift(REVISION_ID), value: drift },
  ],
})

const loading = screenQueryClient()

holdRead(loading, signatureQueryKeys.forRecord(RECORD_ID))

holdRead(loading, revisionEvidenceQueryKeys.drift(REVISION_ID))

holdRead(loading, auditVerificationKeys.status)

const meta = {
  title: 'Review/Evidence inspector',
  component: EvidenceSignatures,
  tags: ['autodocs'],
  args: { recordId: RECORD_ID, revisionId: REVISION_ID },
  decorators: [
    (Story, context) => {
      // Storybook keeps `parameters` as an open bag; every story in this file
      // supplies the client it seeded, built by `screenQueryClient`.
      const client: QueryClient = context.parameters.client

      return (
        <QueryClientProvider client={client}>
          <div className="w-[420px] max-w-full">
            <Story />
          </div>
        </QueryClientProvider>
      )
    },
  ],
} satisfies Meta<typeof EvidenceSignatures>

export default meta

type Story = StoryObj<typeof meta>

/** The signatures that attest this revision. */
export const Signatures: Story = { parameters: { client: signed } }

/** Signatures still loading. */
export const SignaturesLoading: Story = { parameters: { client: loading } }

/** Nothing has moved since signing. */
export const NoDrift: Story = {
  parameters: { client: signed },
  render: (args) => <EvidenceDrift revisionId={args.revisionId} />,
}

/** A rename, a newer dataset version and later comments, in words. */
export const Drifted: Story = {
  parameters: { client: moved },
  render: (args) => <EvidenceDrift revisionId={args.revisionId} />,
}

/** Measured from submission rather than signing. */
export const DriftUnsigned: Story = {
  parameters: { client: moved },
  render: (args) => (
    <EvidenceDrift revisionId={args.revisionId} signed={false} />
  ),
}

/** The drift read is still loading. */
export const DriftLoading: Story = {
  parameters: { client: loading },
  render: (args) => <EvidenceDrift revisionId={args.revisionId} />,
}
