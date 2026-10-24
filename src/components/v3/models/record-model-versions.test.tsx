import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDataClient } from '#/lib/data-client'
import {
  createRecordModelVersion,
  listRecordModelVersions,
  recordModelVersionSchema,
  replaceRecordModelVersionDefinition,
  upgradeRecordModelRecord,
  migrateOpenExperimentsToModelVersion,
} from '#/lib/record-model-versions'
import type { RecordModelVersion } from '#/lib/record-model-versions'
import type { ApprovalRequest } from '#/lib/approval-requests'
import { RecordModelVersions } from './record-model-versions'
import { RecordModelVersionEditor } from './record-model-version-editor'
import { ModelApprovalPanel } from './model-approval-panel'

vi.mock('#/lib/user-names', () => ({
  useUserNames: () => ({ userLabel: (id: string) => id }),
}))

const MODEL_ID = '00000000-0000-4000-8000-00000000c001'
const VERSION_ID = '00000000-0000-4000-8000-00000000c002'
const WORKSPACE_ID = '00000000-0000-4000-8000-00000000c003'
const FIELD_ID = '00000000-0000-4000-8000-00000000c004'
const version: RecordModelVersion = {
  id: VERSION_ID,
  model_id: MODEL_ID,
  workspace_id: WORKSPACE_ID,
  version: 2,
  revision: 7,
  lifecycle: 'draft',
  reason: 'Add a viability range',
  created_at: '2026-10-04T12:00:00Z',
  created_by_user_id: 'author',
  published_at: null,
  definition: {
    identifier_prefix: 'TB',
    rules: [{ id: 'preserved-rule' }],
    fields: [
      {
        id: FIELD_ID,
        field_name: 'viability',
        label: 'Viability',
        logical_type: 'decimal',
        nullable: true,
        display_order: 0,
        lifecycle: 'active',
        default_value: 90,
        validation: { min: 0, max: 100, scientificRule: 'keep-me' },
        cardinality: 'one',
        quantity: { kind: 'viability', dimension: 'ratio', storageUnit: '%' },
      },
    ],
  },
}
const pending: ApprovalRequest = {
  id: '00000000-0000-4000-8000-00000000c005',
  workspace_id: WORKSPACE_ID,
  object_kind: 'record_model_version',
  object_id: VERSION_ID,
  object_revision: 7,
  required_approver_roles: ['owner', 'reviewer'],
  required_approvals: 2,
  require_independence: true,
  state: 'pending',
  reason: 'Review',
  decision_reason: null,
  approved_by_user_ids: [],
  submitted_by_user_id: 'author',
  submitted_at: '2026-10-04T12:10:00Z',
  decided_by_user_id: null,
  decided_at: null,
  created_at: '2026-10-04T12:10:00Z',
  updated_at: '2026-10-04T12:10:00Z',
}

afterEach(cleanup)

describe('Record Model version client contract', () => {
  it('retains field identity, units, rules and validation metadata while rejecting malformed versions', () => {
    expect(recordModelVersionSchema.parse(version)).toEqual(version)
    expect(() =>
      recordModelVersionSchema.parse({ ...version, revision: -1 }),
    ).toThrow()
    expect(() =>
      recordModelVersionSchema.parse({
        ...version,
        definition: {
          fields: [
            { ...version.definition.fields[0], id: 'label-is-not-an-id' },
          ],
        },
      }),
    ).toThrow()
  })

  it('uses Record Model endpoints and sends only identity, revision and reason for an upgrade', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(version)))
    const client = createDataClient(fetcher)
    await createRecordModelVersion(client, {
      modelId: MODEL_ID,
      reason: 'A draft',
    })
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      '/api/db/rpc/create_record_model_version',
    )
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      p_model_id: MODEL_ID,
      p_reason: 'A draft',
    })
    fetcher.mockResolvedValue(new Response(JSON.stringify(null)))
    await upgradeRecordModelRecord(client, {
      recordId: FIELD_ID,
      versionId: VERSION_ID,
      expectedMetadataVersion: 13,
      reason: 'Adopt this definition',
    })
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({
      p_record_id: FIELD_ID,
      p_version_id: VERSION_ID,
      p_expected_metadata_version: 13,
      p_reason: 'Adopt this definition',
    })
    fetcher.mockResolvedValue(new Response(JSON.stringify([version])))
    await listRecordModelVersions(client, MODEL_ID)
    expect(String(fetcher.mock.calls[2]?.[0])).toContain(
      '/api/db/record_model_versions?model_id=eq.',
    )
  })

  it('carries the chosen migration scope in the definition the apply RPC receives', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(version)))
    const client = createDataClient(fetcher)
    await replaceRecordModelVersionDefinition(client, {
      versionId: VERSION_ID,
      expectedRevision: 7,
      definition: version.definition,
      reason: 'Extend the range after service',
      migrationScope: 'also-migrate-open-experiments',
    })
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      '/api/db/rpc/replace_record_model_version_definition',
    )
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      p_version_id: VERSION_ID,
      p_expected_revision: 7,
      p_definition: {
        ...version.definition,
        migrationScope: 'also-migrate-open-experiments',
      },
      p_reason: 'Extend the range after service',
    })
  })

  it('runs the migration batch when the scope is also-migrate-open-experiments', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ migrated: 2, recordIds: ['r-1', 'r-2'] }),
        ),
      )
    const client = createDataClient(fetcher)
    const result = await migrateOpenExperimentsToModelVersion(client, {
      modelId: 'model-1',
      versionId: VERSION_ID,
      reason: 'Extend the range after service',
    })
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      '/api/db/rpc/migrate_open_experiments_to_model_version',
    )
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      p_model_id: 'model-1',
      p_version_id: VERSION_ID,
      p_reason: 'Extend the range after service',
    })
    expect(result).toEqual({ migrated: 2, recordIds: ['r-1', 'r-2'] })
  })

  it('edits a label and numeric range without changing stable keys or discarding semantic metadata', () => {
    const save = vi.fn()
    render(
      <RecordModelVersionEditor
        version={version}
        impact={{
          recordsOnEachVersion: [],
          migratableRecords: 0,
          templates: 0,
          sheets: 0,
        }}
        publishedFieldNames={['viability']}
        publishedVersion={1}
        busy={false}
        onSave={save}
      />,
    )
    const field = screen.getAllByRole('group')[0]
    fireEvent.change(within(field).getByLabelText('Label'), {
      target: { value: 'Viability at release' },
    })
    fireEvent.change(screen.getByLabelText('Maximum'), {
      target: { value: '95' },
    })
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Reason for change' }),
      {
        target: { value: 'Narrow release range' },
      },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(save).toHaveBeenCalledWith(
      {
        ...version.definition,
        fields: [
          {
            ...version.definition.fields[0],
            label: 'Viability at release',
            validation: { min: 0, max: 95, scientificRule: 'keep-me' },
          },
        ],
      },
      'Narrow release range',
      'new-records-only',
    )
  })

  it('locks pending native drafts and queries approvals for Record Models, not Dataset schemas', async () => {
    const requests: string[] = []
    const client = createDataClient(async (url) => {
      const path = String(url)
      requests.push(path)
      const data = path.includes('record_models?')
        ? [{ id: MODEL_ID, key: 'test_bank', name: 'Test bank' }]
        : path.includes('/record_model_versions?')
          ? [version]
          : path.includes('/approval_requests?')
            ? [pending]
            : path.includes('/approval_request_decisions?')
              ? []
              : path.includes('/rpc/record_model_version_usage')
                ? [
                    {
                      version_id: VERSION_ID,
                      record_count: 3,
                      created_record_count: 1,
                      upgraded_record_count: 2,
                      migratable_record_count: 1,
                    },
                  ]
                : []
      return new Response(JSON.stringify(data))
    })
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <RecordModelVersions
          modelKey="test_bank"
          role="steward"
          user={{ id: 'author', name: 'Author' }}
          workspaceId={WORKSPACE_ID}
          client={client}
        />
      </QueryClientProvider>,
    )
    await screen.findByRole('button', { name: 'Withdraw submission' })
    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Publish v2' })).toBeNull()
    expect(
      screen.getAllByText(
        'Locked while awaiting approval from Owner and Reviewer (QA).',
      ).length,
    ).toBeGreaterThan(0)
    await waitFor(() =>
      expect(
        requests.some((path) =>
          path.includes('object_kind=eq.record_model_version'),
        ),
      ).toBe(true),
    )
    expect(requests.some((path) => path.includes('dataset_schema'))).toBe(false)
    queryClient.clear()
  })

  it('submits the Record Model revision with every named role and mandatory independence', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(pending)))
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <ModelApprovalPanel
          version={version}
          objectKind="record_model_version"
          publishedVersion={1}
          requests={[]}
          decisions={[]}
          role="steward"
          user={{ id: 'author', name: 'Author' }}
          workspaceId={WORKSPACE_ID}
          client={createDataClient(fetcher)}
        />
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Submit for approval' }))
    const dialog = await screen.findByRole('dialog')
    const independence = within(dialog).getByRole('checkbox', {
      name: /Require an independent approver/,
    })
    expect(independence).toHaveProperty('disabled', true)
    expect(independence).toHaveProperty('checked', true)
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Reason' }), {
      target: { value: 'Review release range' },
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Submit for approval' }),
    )
    await waitFor(() => expect(fetcher).toHaveBeenCalled())
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      p_workspace_id: WORKSPACE_ID,
      p_object_kind: 'record_model_version',
      p_object_id: VERSION_ID,
      p_object_revision: 7,
      p_required_approver_roles: ['owner', 'reviewer'],
      p_required_approvals: 2,
      p_reason: 'Review release range',
      p_require_independence: true,
    })
    queryClient.clear()
  })
})
