import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

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
import { draftCopyReducer, initialDraftCopy } from './record-model-draft-state'

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

function fixtureTransport(initialResponse: Response) {
  let response = initialResponse
  const requests: Request[] = []

  const client = createDataClient(async (input, init) => {
    requests.push(
      new Request(
        new URL(
          input instanceof Request ? input.url : input,
          'http://localhost',
        ),
        init,
      ),
    )

    return response.clone()
  })

  return {
    client,
    requests,
    respondWith: (value: Response) => {
      response = value
    },
  }
}

function renderWithProviders(children: ReactNode, queryClient: QueryClient) {
  queryClient.setQueryData(['user-names', ['author']], { author: 'Author' })

  const router = createRouter({
    routeTree: createRootRoute({ component: () => children }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

describe('Record Model version client contract', () => {
  it('keeps edits made during a save dirty while advancing the expected revision', () => {
    const initial = initialDraftCopy(version)

    const submitted = version.definition.fields.map((field) => ({
      ...field,
      label: 'Submitted label',
    }))

    const later = submitted.map((field) => ({
      ...field,
      label: 'Still typing',
    }))

    const editing = draftCopyReducer(initial, { type: 'edit', fields: later })

    const saved = draftCopyReducer(editing, {
      type: 'saved',
      version: { ...version, revision: 8 },
      submitted,
      savedAt: '2026-10-04T12:01:00Z',
    })

    expect(saved.fields).toBe(later)
    expect(saved.dirty).toBe(true)
    expect(saved.revision).toBe(8)
    expect(draftCopyReducer(saved, { type: 'received', version })).toBe(saved)

    const clean = draftCopyReducer(saved, {
      type: 'saved',
      version: { ...version, revision: 9 },
      submitted: later,
      savedAt: '2026-10-04T12:02:00Z',
    })

    expect(clean.dirty).toBe(false)
    expect(clean.fields[0].quantity).toEqual(
      version.definition.fields[0].quantity,
    )
    expect(clean.fields[0].validation).toEqual(
      version.definition.fields[0].validation,
    )
  })

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
    const { client, requests, respondWith } = fixtureTransport(
      Response.json(version),
    )

    await createRecordModelVersion(client, {
      modelId: MODEL_ID,
      reason: 'A draft',
    })
    expect(requests[0]?.url).toBe(
      'http://localhost/api/db/rpc/create_record_model_version',
    )
    expect(await requests[0]?.json()).toEqual({
      p_model_id: MODEL_ID,
      p_reason: 'A draft',
    })
    respondWith(Response.json(null))
    await upgradeRecordModelRecord(client, {
      recordId: FIELD_ID,
      versionId: VERSION_ID,
      expectedMetadataVersion: 13,
      reason: 'Adopt this definition',
    })
    expect(await requests[1]?.json()).toEqual({
      p_record_id: FIELD_ID,
      p_version_id: VERSION_ID,
      p_expected_metadata_version: 13,
      p_reason: 'Adopt this definition',
    })
    respondWith(Response.json([version]))
    await listRecordModelVersions(client, MODEL_ID)
    expect(requests[2]?.url).toContain(
      '/api/db/record_model_versions?model_id=eq.',
    )
  })

  it('carries the chosen migration scope in the definition the apply RPC receives', async () => {
    const { client, requests } = fixtureTransport(Response.json(version))
    await replaceRecordModelVersionDefinition(client, {
      versionId: VERSION_ID,
      expectedRevision: 7,
      definition: version.definition,
      reason: 'Extend the range after service',
      migrationScope: 'also-migrate-open-experiments',
    })
    expect(requests[0]?.url).toBe(
      'http://localhost/api/db/rpc/replace_record_model_version_definition',
    )
    expect(await requests[0]?.json()).toEqual({
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
    const { client, requests } = fixtureTransport(
      Response.json({ migrated: 2, recordIds: ['r-1', 'r-2'] }),
    )

    const result = await migrateOpenExperimentsToModelVersion(client, {
      modelId: 'model-1',
      versionId: VERSION_ID,
      reason: 'Extend the range after service',
    })

    expect(requests[0]?.url).toBe(
      'http://localhost/api/db/rpc/migrate_open_experiments_to_model_version',
    )
    expect(await requests[0]?.json()).toEqual({
      p_model_id: 'model-1',
      p_version_id: VERSION_ID,
      p_reason: 'Extend the range after service',
    })
    expect(result).toEqual({ migrated: 2, recordIds: ['r-1', 'r-2'] })
  })

  it('edits a label and numeric range without changing stable keys or discarding semantic metadata', async () => {
    const { client, requests } = fixtureTransport(Response.json(version))
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
        onSave={(definition, reason, migrationScope) =>
          replaceRecordModelVersionDefinition(client, {
            versionId: VERSION_ID,
            expectedRevision: 7,
            definition,
            reason,
            migrationScope,
          })
        }
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
    await waitFor(() => expect(requests).toHaveLength(1))
    expect(await requests[0]?.json()).toEqual({
      p_version_id: VERSION_ID,
      p_expected_revision: 7,
      p_definition: {
        ...version.definition,
        migrationScope: 'new-records-only',
        fields: [
          {
            ...version.definition.fields[0],
            label: 'Viability at release',
            validation: { min: 0, max: 95, scientificRule: 'keep-me' },
          },
        ],
      },
      p_reason: 'Narrow release range',
    })
  })

  it('locks pending native drafts and queries approvals for Record Models, not Dataset schemas', async () => {
    const requests: string[] = []

    const client = createDataClient(async (url) => {
      const path = new URL(
        url instanceof Request ? url.url : url,
        'http://localhost',
      ).href

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
        queries: { retry: false, staleTime: Infinity },
        mutations: { retry: false },
      },
    })

    renderWithProviders(
      <RecordModelVersions
        modelKey="test_bank"
        role="steward"
        user={{ id: 'author', name: 'Author' }}
        workspaceId={WORKSPACE_ID}
        client={client}
      />,
      queryClient,
    )
    await screen.findByRole('button', { name: 'Withdraw submission' })
    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Publish v2' })).toBeNull()
    expect(
      screen.getAllByText(
        'Locked while awaiting approval from Owner and Reviewer.',
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
    const { client, requests } = fixtureTransport(Response.json(pending))

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
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
          client={client}
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
    await waitFor(() => expect(requests).toHaveLength(1))
    expect(await requests[0]?.json()).toEqual({
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
