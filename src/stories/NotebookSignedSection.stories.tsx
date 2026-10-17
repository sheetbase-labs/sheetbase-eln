import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { NotebookSignedSection } from '#/components/notebook/notebook-viewer-actions'
import { signatureQueryKeys } from '#/lib/signatures'
import type { SignatureWire } from '#/lib/signatures'

/**
 * The signatures footer of a signed notebook. It reads the record's
 * signatures, so stories seed that read (or refuse it) — the table below is
 * the same `SignaturesTable` the review surface uses.
 */
const RECORD_ID = '0198d970-e266-4000-8000-0000000000a1'

function signature(overrides: Partial<SignatureWire> = {}): SignatureWire {
  return {
    id: 'sig-1',
    workspace_id: 'workspace-1',
    submission_id: 'sub-1',
    revision_id: 'rev-1',
    record_id: RECORD_ID,
    signature_meaning: 'authored',
    assurance_level: 'standard',
    revision_integrity_digest: '4c9620bbd4f931955d4d42820a77fa9d',
    signer_user_id: 'user-1',
    signer_session_id: 'session-1',
    signer_role: 'member',
    auth_method: 'password',
    confirmation_phrase: 'Ava Chen',
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
    signature_meaning: 'reviewed-and-approved',
    signer_user_id: 'user-2',
    signer_name: 'Priya Raman',
    signed_at: '2026-07-30T09:12:00Z',
    created_at: '2026-07-30T09:12:00Z',
  }),
]

function client(state: 'ready' | 'loading' | 'error') {
  if (state === 'error') {
    return new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          queryFn: () => Promise.reject(new Error('offline')),
        },
      },
    })
  }
  const instance = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  if (state === 'ready') {
    instance.setQueryData(signatureQueryKeys.forRecord(RECORD_ID), signatures)
  }
  return instance
}

function withClient(state: 'ready' | 'loading' | 'error') {
  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={client(state)}>
      <div className="w-[860px] max-w-full">
        <Story />
      </div>
    </QueryClientProvider>
  )
}

const meta = {
  title: 'Notebook/Signed section',
  component: NotebookSignedSection,
  tags: ['autodocs'],
  decorators: [withClient('ready')],
  args: { recordId: RECORD_ID },
} satisfies Meta<typeof NotebookSignedSection>
export default meta
type Story = StoryObj<typeof meta>

/** The recorded signatures, oldest first. */
export const Default: Story = {}

/** A record with no signatures yet. */
export const None: Story = {
  decorators: [
    (Story) => (
      <QueryClientProvider
        client={((): QueryClient => {
          const instance = client('ready')
          instance.setQueryData(signatureQueryKeys.forRecord(RECORD_ID), [])
          return instance
        })()}
      >
        <div className="w-[860px] max-w-full">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
}

/** While the read is in flight the table must not read as “none”. */
export const Loading: Story = { decorators: [withClient('loading')] }

/** A refused read is reported as a failure. */
export const ReadError: Story = { decorators: [withClient('error')] }
