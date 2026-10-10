import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { createDataClient } from '#/lib/data-client'
import type { RecordModelVersion } from '#/lib/record-model-versions'
import { RecordModelVersions } from './record-model-versions'

const modelId = '00000000-0000-4000-8000-00000000e001'
const workspaceId = '00000000-0000-4000-8000-00000000e002'
const versionId = '00000000-0000-4000-8000-00000000e003'
const fieldId = '00000000-0000-4000-8000-00000000e004'
const version: RecordModelVersion = {
  id: versionId,
  model_id: modelId,
  workspace_id: workspaceId,
  version: 2,
  revision: 1,
  lifecycle: 'draft',
  reason: 'Add a release viability range',
  created_at: '2026-10-04T12:00:00Z',
  created_by_user_id: 'preview-author',
  published_at: null,
  definition: {
    identifier_prefix: 'PV',
    fields: [
      {
        id: fieldId,
        field_name: 'viability',
        label: 'Viability',
        logical_type: 'decimal',
        nullable: true,
        display_order: 0,
        lifecycle: 'active',
        default_value: 90,
        cardinality: 'one',
        validation: { min: 0, max: 100 },
      },
    ],
  },
}

function Preview({ state }: { state: 'draft' | 'pending' | 'unavailable' }) {
  const [queryClient] = useState(() => {
    const query = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    query.setQueryData(['user-names', ['preview-author']], {
      'preview-author': 'Preview author',
    })
    return query
  })
  const [client] = useState(() =>
    createDataClient(async (url, init) => {
      const path = String(url)
      if (
        state === 'unavailable' ||
        (init?.method === 'POST' && !path.includes('version_usage'))
      ) {
        return new Response(
          JSON.stringify({
            code: 'preview_only',
            message: 'This component preview has no server authority.',
          }),
          { status: 503 },
        )
      }
      const data = path.includes('/record_models?')
        ? [{ id: modelId, key: 'preview_bank', name: 'Synthetic preview bank' }]
        : path.includes('/record_model_versions?')
          ? [
              version,
              {
                ...version,
                id: '00000000-0000-4000-8000-00000000e005',
                version: 1,
                lifecycle: 'published',
                reason: 'Initial definition',
                published_at: '2026-10-04T11:00:00Z',
              },
            ]
          : path.includes('/approval_requests?')
            ? state === 'pending'
              ? [
                  {
                    id: '00000000-0000-4000-8000-00000000e006',
                    workspace_id: workspaceId,
                    object_kind: 'record_model_version',
                    object_id: versionId,
                    object_revision: 1,
                    required_approver_roles: ['owner', 'reviewer'],
                    required_approvals: 2,
                    require_independence: true,
                    state: 'pending',
                    reason: 'Review release range',
                    decision_reason: null,
                    submitted_by_user_id: 'preview-author',
                    submitted_at: '2026-10-04T12:10:00Z',
                    approved_by_user_ids: [],
                    decided_by_user_id: null,
                    decided_at: null,
                    created_at: '2026-10-04T12:10:00Z',
                    updated_at: '2026-10-04T12:10:00Z',
                  },
                ]
              : []
            : path.includes('/rpc/record_model_version_usage')
              ? [versionId, '00000000-0000-4000-8000-00000000e005'].map(
                  (id) => ({
                    version_id: id,
                    record_count: 0,
                    created_record_count: 0,
                    upgraded_record_count: 0,
                  }),
                )
              : []
      return new Response(JSON.stringify(data))
    }),
  )
  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex h-[800px] flex-col">
        <p className="m-0 border-b border-border p-3 text-label text-fg-muted">
          Synthetic component fixture only. Not migrated database evidence or
          Roadmap acceptance.
        </p>
        <RecordModelVersions
          modelKey="preview_bank"
          role="steward"
          user={{ id: 'preview-author', name: 'Preview author' }}
          workspaceId={workspaceId}
          client={client}
        />
      </div>
    </QueryClientProvider>
  )
}

const meta = {
  title: 'Models/Record Model versions',
  component: Preview,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Preview>
export default meta
type Story = StoryObj<typeof meta>
export const Draft: Story = { args: { state: 'draft' } }
export const Pending: Story = { args: { state: 'pending' } }
export const Unavailable: Story = { args: { state: 'unavailable' } }
