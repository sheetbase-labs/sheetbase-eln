import { describe, expect, it, vi } from 'vitest'

import { validSheetDefinitionConfiguration } from '../../tests/fixtures/sheet-definition'
import type { DataClient } from './data-client'
import {
  AI_CONTEXT_VERSION,
  DEFAULT_AI_CONTEXT_BUDGETS,
  assembleAiContext,
} from './ai-context'
import type { AiContextActor, AiObjectRef } from './ai-context'
import { validSheetInstanceState } from './sheet-instance.test'

const WS = '20000000-0000-4000-8000-000000000001'
const ACTOR: AiContextActor = { kind: 'user', id: 'user-1' }
function recordWire(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rec-1',
    workspace_id: WS,
    project_id: 'proj-1',
    folder_id: null,
    kind: 'experiment',
    identifier: 'EXP-2026-0001',
    title: 'Visible experiment',
    status: 'active',
    tags: ['kinetics'],
    structure_version: 1,
    metadata_version: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-02-01T00:00:00Z',
    archived_at: null,
    deleted_at: null,
    created_by_user_id: 'user-1',
    updated_by_user_id: null,
    properties: { organism: 'E. coli', passages: 3 },
    custom_fields: null,
    locked_at: null,
    locked_by_revision_id: null,
    ...overrides,
  }
}

/** RLS-filtered mock: `tables` is what the actor is allowed to see. */
function mockClient(
  tables: Record<string, unknown[]>,
  rpcImpl?: (name: string, args: Record<string, unknown>) => unknown,
): DataClient & { rpcMock: ReturnType<typeof vi.fn> } {
  const rpcMock = vi.fn(
    async (name: string, args: Record<string, unknown>) =>
      rpcImpl?.(name, args) ?? null,
  )
  const client = {
    list: vi.fn(async (resource: string) => tables[resource] ?? []),
    count: vi.fn(async () => 0),
    rpc: rpcMock,
    insert: vi.fn(async () => ({})),
    patch: vi.fn(async () => []),
    remove: vi.fn(async () => []),
  } as unknown as DataClient & {
    rpcMock: ReturnType<typeof vi.fn>
    list: ReturnType<typeof vi.fn>
    insert: ReturnType<typeof vi.fn>
    patch: ReturnType<typeof vi.fn>
    remove: ReturnType<typeof vi.fn>
  }
  return client
}

function assemble(
  client: DataClient,
  refs: AiObjectRef[],
  extra: { projectId?: string | null; budgets?: Record<string, number> } = {},
) {
  return assembleAiContext(client, ACTOR, {
    workspaceId: WS,
    objectRefs: refs,
    ...extra,
  })
}

describe('ai-context envelope', () => {
  it('returns a versioned envelope with actor, workspace, and budget usage', async () => {
    const client = mockClient({ records: [recordWire()] })
    const envelope = await assemble(client, [{ kind: 'record', id: 'rec-1' }])

    expect(envelope.version).toBe(AI_CONTEXT_VERSION)
    expect(envelope.actor).toEqual(ACTOR)
    expect(envelope.workspace).toEqual({ id: WS, project: null })
    expect(envelope.objects).toHaveLength(1)
    expect(envelope.omissions).toEqual([])
    expect(envelope.budgets.applied).toEqual(DEFAULT_AI_CONTEXT_BUDGETS)
    expect(envelope.budgets.usage.objects).toBe(1)
    expect(envelope.budgets.usage.sections).toBe(
      envelope.objects[0].sections.length,
    )
    expect(envelope.budgets.usage.chars).toBeGreaterThan(0)
  })

  it('never persists: no insert, patch, or remove calls', async () => {
    const client = mockClient({ records: [recordWire()] })
    await assemble(client, [{ kind: 'record', id: 'rec-1' }])
    expect(client.insert).not.toHaveBeenCalled()
    expect(client.patch).not.toHaveBeenCalled()
    expect(client.remove).not.toHaveBeenCalled()
  })

  it('resolves the project summary and marks a missing project as omitted', async () => {
    const project = {
      id: 'proj-1',
      workspace_id: WS,
      key: 'P-1',
      title: 'Kinetics',
      status: 'active',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      archived_at: null,
    }
    const seen = await assemble(mockClient({ projects: [project] }), [], {
      projectId: 'proj-1',
    })
    expect(seen.workspace.project).toEqual({ id: 'proj-1', title: 'Kinetics' })

    const missing = await assemble(mockClient({ projects: [] }), [], {
      projectId: 'proj-1',
    })
    expect(missing.workspace.project).toBeNull()
    expect(missing.omissions).toHaveLength(1)
    expect(missing.omissions[0]).toMatchObject({
      kind: 'project',
      id: 'proj-1',
      reason: 'not_visible',
    })
  })

  it('fails closed without a workspace or actor identity', async () => {
    const client = mockClient({})
    await expect(
      assembleAiContext(client, ACTOR, { workspaceId: '', objectRefs: [] }),
    ).rejects.toThrow(/workspaceId/)
    await expect(
      assembleAiContext(
        client,
        { kind: 'user', id: '' },
        { workspaceId: WS, objectRefs: [] },
      ),
    ).rejects.toThrow(/actor/)
  })
})

describe('record summaries', () => {
  it('summarises identity, provenance, and properties as live', async () => {
    const client = mockClient({ records: [recordWire()] })
    const envelope = await assemble(client, [{ kind: 'record', id: 'rec-1' }])
    const object = envelope.objects[0]

    expect(object.kind).toBe('record')
    expect(object.title).toBe('Visible experiment')
    expect(object.deepLink).toBe('/records/rec-1')
    expect(object.freshness).toBe('live')
    expect(object.pins).toEqual([])
    expect(object.sections.map((s) => s.heading)).toEqual([
      'identity',
      'provenance',
      'properties',
    ])
    const identity = object.sections[0].body
    expect(identity).toContain('EXP-2026-0001')
    expect(object.sections[1].body).toContain('freshness: live')
    expect(object.sections[2].body).toContain('organism: E. coli')
  })

  it('redacts secret-shaped property keys', async () => {
    const client = mockClient({
      records: [
        recordWire({
          properties: { token: 'super-secret', organism: 'E. coli' },
        }),
      ],
    })
    const envelope = await assemble(client, [{ kind: 'record', id: 'rec-1' }])
    const body = envelope.objects[0].sections[2].body
    expect(body).toContain('[redacted]')
    expect(body).not.toContain('super-secret')
  })
})

describe('notebook summaries', () => {
  const blocks = [
    {
      id: 'block-1',
      record_id: 'rec-1',
      type: 'callout',
      payload: { text: 'Handle with care' },
      payload_schema_version: 1,
      order: 0,
      version: 1,
    },
    {
      id: 'block-2',
      record_id: 'rec-1',
      type: 'analysis',
      payload: {
        definitionId: 'def-1',
        frozen: {
          revisionId: null,
          frozenAt: '2026-03-01T00:00:00Z',
          frozenByUserId: 'user-1',
          definition: { datasets: [] },
          definitionName: 'Growth',
          definitionVersion: 2,
          columns: [],
          datasetProvenance: [
            {
              datasetId: 'ds-1',
              datasetVersionId: 'dsv-1',
              schemaVersionNumber: 3,
              sourceDatasetRevision: 7,
              rowCount: 120,
              checksum: 'abc123',
            },
          ],
        },
      },
      payload_schema_version: 1,
      order: 1,
      version: 1,
    },
    {
      id: 'block-3',
      record_id: 'rec-1',
      type: 'analysis',
      payload: { definitionId: 'def-2' },
      payload_schema_version: 1,
      order: 2,
      version: 1,
    },
  ]
  const links = [
    {
      id: 'link-1',
      source_record_id: 'rec-1',
      target_record_id: 'rec-9',
      target_kind: 'sample',
      target_identifier: 'SMP-2026-0009',
      link_type: 'sample',
      created_at: '2026-01-05T00:00:00Z',
    },
  ]

  it('states frozen pins with evidence and marks draft analysis live', async () => {
    const client = mockClient({
      records: [recordWire()],
      blocks,
      record_links: links,
    })
    const envelope = await assemble(client, [{ kind: 'notebook', id: 'rec-1' }])
    const object = envelope.objects[0]

    expect(object.freshness).toBe('live')
    expect(object.pins).toHaveLength(1)
    expect(object.pins[0]).toMatchObject({
      kind: 'analysis_freeze',
      id: 'dsv-1',
    })
    expect(object.pins[0].detail).toContain('120 rows')
    expect(object.pins[0].detail).toContain('abc123')

    const bodies = object.sections.map((s) => s.body).join('\n---\n')
    expect(bodies).toContain('Handle with care')
    expect(bodies).toContain('pinned: frozen analysis')
    expect(bodies).toContain('live: draft analysis definition def-2')
    expect(bodies).toContain('SMP-2026-0009')
  })
})

describe('permission isolation', () => {
  it('marks RLS-invisible objects with an explicit omission marker', async () => {
    // Empty tables simulate RLS hiding every row from this actor.
    const client = mockClient({})
    const envelope = await assemble(client, [
      { kind: 'record', id: 'rec-hidden' },
      { kind: 'dataset', id: 'ds-hidden' },
    ])

    expect(envelope.objects).toEqual([])
    expect(envelope.omissions).toHaveLength(2)
    for (const omission of envelope.omissions) {
      expect(omission.reason).toBe('not_visible')
      expect(omission.detail).toContain('omitted without material')
    }
  })

  it('omits foreign-workspace rows without leaking their material', async () => {
    const client = mockClient({
      records: [
        recordWire({
          id: 'rec-foreign',
          workspace_id: 'ws-other',
          title: 'Classified foreign title',
          properties: { secret: 'foreign-material' },
        }),
      ],
    })
    const envelope = await assemble(client, [
      { kind: 'record', id: 'rec-foreign' },
    ])

    expect(envelope.objects).toEqual([])
    expect(envelope.omissions[0].reason).toBe('wrong_workspace')
    const serialised = JSON.stringify(envelope)
    expect(serialised).not.toContain('Classified foreign title')
    expect(serialised).not.toContain('foreign-material')
  })

  it('rejects unknown ref kinds at runtime with an explicit omission', async () => {
    const client = mockClient({})
    const envelope = await assemble(client, [
      { kind: 'starship', id: 'x' } as unknown as AiObjectRef,
    ])
    expect(envelope.objects).toEqual([])
    expect(envelope.omissions[0].reason).toBe('unsupported_kind')
    expect(envelope.omissions[0].detail).toContain('starship')
  })
})

describe('budget enforcement', () => {
  it('truncates oversized sections with an explicit marker naming the cut', async () => {
    const client = mockClient({
      records: [recordWire({ title: 'A very long title '.repeat(50) })],
    })
    const envelope = await assemble(client, [{ kind: 'record', id: 'rec-1' }], {
      budgets: { maxCharsPerSection: 120 },
    })
    const truncated = envelope.objects[0].sections.filter((s) => s.truncated)
    expect(truncated.length).toBeGreaterThan(0)
    for (const section of truncated) {
      expect(section.body).toContain('[truncated:')
      expect(section.body).toContain(section.heading)
      expect(section.body.length).toBeLessThanOrEqual(120)
    }
  })

  it('drops trailing sections over the per-object cap and names them', async () => {
    const client = mockClient({ records: [recordWire()] })
    const envelope = await assemble(client, [{ kind: 'record', id: 'rec-1' }], {
      budgets: { maxSectionsPerObject: 1 },
    })
    const object = envelope.objects[0]
    expect(object.truncated).toBe(true)
    const tail = object.sections.at(-1)
    expect(tail?.heading).toBe('truncation')
    expect(tail?.body).toContain('maxSectionsPerObject=1')
    expect(tail?.body).toContain('provenance')
    expect(tail?.body).toContain('properties')
  })

  it('drops objects over the total budget as explicit omissions', async () => {
    const client = mockClient({ records: [recordWire()] })
    const envelope = await assemble(client, [{ kind: 'record', id: 'rec-1' }], {
      budgets: { maxCharsTotal: 10 },
    })
    expect(envelope.objects).toEqual([])
    expect(envelope.omissions[0]).toMatchObject({
      kind: 'record',
      id: 'rec-1',
      reason: 'budget_exceeded',
    })
    expect(envelope.omissions[0].detail).toContain('maxCharsTotal=10')
  })

  it('caps requested refs at maxObjects and names the dropped refs', async () => {
    const client = mockClient({ records: [recordWire()] })
    const envelope = await assemble(
      client,
      [
        { kind: 'record', id: 'rec-1' },
        { kind: 'record', id: 'rec-2' },
        { kind: 'record', id: 'rec-3' },
      ],
      { budgets: { maxObjects: 1 } },
    )
    expect(envelope.objects).toHaveLength(1)
    expect(envelope.budgets.usage.objects).toBe(1)
    const dropped = envelope.omissions.filter(
      (o) => o.reason === 'budget_exceeded',
    )
    expect(dropped).toHaveLength(2)
    expect(dropped[0].detail).toContain('rec-2')
    expect(dropped[1].detail).toContain('rec-3')
  })
})

describe('dataset summaries', () => {
  const datasetTables = () => ({
    datasets: [
      {
        id: 'ds-1',
        workspace_id: WS,
        schema_version_id: 'sv-1',
        name: 'Growth curves',
        description: 'OD600 time series',
        lifecycle: 'active',
        revision: 7,
      },
    ],
    dataset_schema_version_fields: [
      {
        field_id: 'od600',
        schema_version_id: 'sv-1',
        key: 'od600',
        label: 'OD600',
        logical_type: 'decimal',
        nullable: false,
        quantity: null,
        validation: {},
        lifecycle: 'active',
        display_order: 0,
      },
    ],
    dataset_schema_versions: [{ id: 'sv-1', schema_id: 'sd-1', version: 3 }],
    dataset_schema_definitions: [{ id: 'sd-1', name: 'Growth', key: 'growth' }],
  })

  it('summarises schema and a bounded live row sample', async () => {
    const rpcImpl = (name: string, args: Record<string, unknown>) => {
      expect(name).toBe('query_dataset_rows')
      expect(args.p_limit).toBe(2)
      return {
        rows: [
          { rowId: 'row-1', revision: 1, values: { od600: 0.42 } },
          { rowId: 'row-2', revision: 1, values: { od600: 0.87 } },
        ],
        totalCount: 120,
      }
    }
    const client = mockClient(datasetTables(), rpcImpl)
    const envelope = await assemble(
      client,
      [{ kind: 'dataset', id: 'ds-1', includeSampleRows: true }],
      { budgets: { maxRowsPerDataset: 2 } },
    )
    const object = envelope.objects[0]

    expect(object.freshness).toBe('live')
    expect(object.deepLink).toBe('/datasets?dataset=ds-1')
    const headings = object.sections.map((s) => s.heading)
    expect(headings).toEqual(['identity', 'schema', 'sample_rows'])
    expect(object.sections[0].body).toContain('revision: 7')
    expect(object.sections[1].body).toContain('OD600')
    expect(object.sections[2].body).toContain('first 2 of 120 rows (live)')
    expect(envelope.budgets.usage.rows).toBe(2)
  })

  it('withholds live rows for a pinned version and states the pin', async () => {
    const rpc = vi.fn(
      async <T>(..._args: unknown[]): Promise<T> =>
        ({ rows: [], totalCount: 0 }) as T,
    )
    const base = mockClient(datasetTables())
    const client: DataClient = {
      ...base,
      rpc: rpc as unknown as DataClient['rpc'],
    }
    const envelope = await assemble(client, [
      {
        kind: 'dataset',
        id: 'ds-1',
        includeSampleRows: true,
        pinnedVersionId: 'dsv-1',
      },
    ])
    const object = envelope.objects[0]

    expect(object.freshness).toBe('pinned')
    expect(object.pins[0]).toMatchObject({
      kind: 'dataset_version',
      id: 'dsv-1',
    })
    expect(object.sections.map((s) => s.heading)).not.toContain('sample_rows')
    expect(rpc).not.toHaveBeenCalled()
    expect(envelope.budgets.usage.rows).toBe(0)
  })
})

describe('sheet and analysis summaries', () => {
  it('summarises a live sheet instance with its source definition pin', async () => {
    const sheetId = '30000000-0000-4000-8000-000000000011'
    const client = mockClient({
      sheet_instances: [
        {
          id: sheetId,
          workspace_id: WS,
          project_id: null,
          notebook_record_id: null,
          source_definition_version_id: '30000000-0000-4000-8000-000000000012',
          name: 'Plate map',
          description: null,
          lifecycle: 'active',
          revision: 4,
          state: validSheetInstanceState(),
          duplicated_from_instance_id: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-02-01T00:00:00Z',
          created_by_user_id: null,
          updated_by_user_id: null,
        },
      ],
    })
    const envelope = await assemble(client, [{ kind: 'sheet', id: sheetId }])
    const object = envelope.objects[0]

    expect(object.freshness).toBe('live')
    expect(object.deepLink).toBe(`/sheets/${sheetId}`)
    expect(object.pins[0]).toMatchObject({
      kind: 'sheet_definition_version',
      id: '30000000-0000-4000-8000-000000000012',
    })
    expect(object.sections[0].body).toContain('revision: 4')
  })

  it('falls back to the sheet definition and honours a resolved pin', async () => {
    const client = mockClient({
      sheet_instances: [],
      sheet_definitions: [
        {
          id: 'sdef-1',
          workspace_id: WS,
          key: 'plate-map',
          name: 'Plate map template',
          description: null,
          lifecycle: 'active',
          revision: 2,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-02-01T00:00:00Z',
          created_by_user_id: null,
          updated_by_user_id: null,
        },
      ],
      sheet_definition_versions: [
        {
          id: 'sdv-3',
          definition_id: 'sdef-1',
          version: 3,
          lifecycle: 'published',
          configuration_format_version: 1,
          configuration: validSheetDefinitionConfiguration(),
          revision: 3,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-02-01T00:00:00Z',
          created_by_user_id: null,
          updated_by_user_id: null,
          published_at: '2026-02-01T00:00:00Z',
          published_by_user_id: null,
          retired_at: null,
          retired_by_user_id: null,
        },
      ],
    })
    const envelope = await assemble(client, [
      { kind: 'sheet', id: 'sdef-1', pinnedVersionId: 'sdv-3' },
    ])
    const object = envelope.objects[0]

    expect(object.freshness).toBe('pinned')
    expect(object.pins[0]).toMatchObject({
      kind: 'sheet_definition_version',
      id: 'sdv-3',
    })
    expect(object.sections[0].body).toContain('pinned')
  })

  it('summarises analysis sources with their schema versions', async () => {
    const client = mockClient({
      analysis_definitions: [
        {
          id: 'def-1',
          workspace_id: WS,
          owner_user_id: 'user-1',
          name: 'Growth fit',
          version: 2,
          definition: {},
          source_revisions: [
            { datasetId: 'ds-1', schemaVersionNumber: 3, revision: 7 },
          ],
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-02-01T00:00:00Z',
        },
      ],
    })
    const envelope = await assemble(client, [{ kind: 'analysis', id: 'def-1' }])
    const object = envelope.objects[0]

    expect(object.freshness).toBe('live')
    // Saved definitions have no product deep-link surface; AI-02 cites the
    // source datasets/versions instead.
    expect(object.deepLink).toBeNull()
    expect(object.sections[1].body).toContain(
      'dataset ds-1: schema version 3, revision 7',
    )
  })
})
