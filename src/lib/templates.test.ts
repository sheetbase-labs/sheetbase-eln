/**
 * SCI-006 / TPL-001 unit tests: template kind/status helpers, lifecycle
 * transition rules, instantiable-status checks, target-kind compatibility,
 * archive/duplicate/export/usage helpers, permission checks and favourites.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  allowedTemplateTransitions,
  archiveDependencyWarning,
  archiveTemplate,
  buildTemplateExport,
  canManageTemplate,
  createTemplateFavouritesStore,
  duplicateTemplate,
  fetchTemplates,
  fetchTemplateUsage,
  INSTANTIABLE_STATUSES,
  INSTANTIABLE_TARGET_KINDS,
  isAllowedTemplateTransition,
  isInstantiable,
  isTemplateKind,
  TEMPLATE_KIND_LABEL,
  TEMPLATE_KIND_PREFIX,
  TEMPLATE_KINDS,
  templateFavouritesStorageKey,
  TEMPLATE_TRANSITIONS,
  toTemplateUsageItem,
} from './templates'
import type { NotebookBlock, NotebookRecord } from './notebook-data'
import { sanitizeQuery } from './postgrest-path'

describe('SCI-006 template domain helpers', () => {
  describe('isTemplateKind', () => {
    it('recognises protocol_template as a template kind', () => {
      expect(isTemplateKind('protocol_template')).toBe(true)
    })

    it.each([
      'notebook_template',
      'experiment',
      'sample',
      'reagent',
      'report',
      'file',
      '',
    ])('rejects %s as a template kind', (kind) => {
      expect(isTemplateKind(kind)).toBe(false)
    })
  })

  describe('TEMPLATE constants', () => {
    it('exposes only protocol_template', () => {
      expect(TEMPLATE_KINDS).toEqual(['protocol_template'])
    })

    it('maps protocol templates to a stable prefix and label', () => {
      expect(TEMPLATE_KIND_PREFIX.protocol_template).toBe('PRT')
      expect(TEMPLATE_KIND_LABEL.protocol_template).toBe('Protocol')
    })
  })

  describe('isInstantiable', () => {
    it('allows active protocol templates that are not archived', () => {
      expect(isInstantiable('protocol_template', 'active', null)).toBe(true)
    })

    it('rejects draft templates', () => {
      expect(isInstantiable('protocol_template', 'draft', null)).toBe(false)
    })

    it('rejects archived templates regardless of status', () => {
      expect(
        isInstantiable('protocol_template', 'active', '2026-01-01T00:00:00Z'),
      ).toBe(false)
    })

    it('rejects under_review protocol templates', () => {
      expect(isInstantiable('protocol_template', 'under_review', null)).toBe(
        false,
      )
    })
  })

  describe('lifecycle transitions', () => {
    it('allows protocol_template draft → active and draft → under_review', () => {
      expect(
        isAllowedTemplateTransition('protocol_template', 'draft', 'active'),
      ).toBe(true)
      expect(
        isAllowedTemplateTransition(
          'protocol_template',
          'draft',
          'under_review',
        ),
      ).toBe(true)
    })

    it('rejects protocol_template draft → validated (not a protocol status)', () => {
      expect(
        isAllowedTemplateTransition('protocol_template', 'draft', 'validated'),
      ).toBe(false)
    })

    it('returns an empty array for an unknown source status', () => {
      expect(
        allowedTemplateTransitions('protocol_template', 'archived'),
      ).toEqual([])
    })

    it('defines a complete transition matrix for protocol templates', () => {
      expect(TEMPLATE_TRANSITIONS.protocol_template).toEqual({
        draft: ['active', 'under_review'],
        under_review: ['active', 'draft'],
        active: ['draft'],
      })
    })
  })

  describe('instantiable statuses and target kinds', () => {
    it('only allows active for protocol templates', () => {
      expect(INSTANTIABLE_STATUSES.protocol_template).toEqual(['active'])
    })

    it('allows protocol templates to target experiments and protocol templates', () => {
      expect(INSTANTIABLE_TARGET_KINDS.protocol_template).toEqual([
        'experiment',
        'protocol_template',
      ])
    })
  })
})

// ---------------------------------------------------------------------------
// TPL-001: archive / duplicate / export / usage / favourites / permissions
// ---------------------------------------------------------------------------

function record(overrides: Partial<NotebookRecord> = {}): NotebookRecord {
  return {
    id: 't-1',
    projectId: 'p-1',
    kind: 'protocol_template',
    identifier: 'PRT-2026-0001',
    title: 'Stability Study',
    status: 'active',
    tags: ['stability'],
    structureVersion: 2,
    metadataVersion: 3,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    archivedAt: null,
    deletedAt: null,
    createdByUserId: 'u-1',
    updatedByUserId: null,
    properties: { version: '1.0' },
    lockedAt: null,
    lockedByRevisionId: null,
    ...overrides,
  }
}

const sampleBlocks: NotebookBlock[] = [
  {
    id: 'b-1',
    recordId: 't-1',
    type: 'rich_text',
    payload: { doc: { type: 'doc' } },
    payloadSchemaVersion: 1,
    order: 2,
    version: 1,
  },
  {
    id: 'b-2',
    recordId: 't-1',
    type: 'checklist',
    payload: { items: [] },
    payloadSchemaVersion: 1,
    order: 1,
    version: 1,
  },
]

describe('TPL-001 buildTemplateExport', () => {
  it('builds a deterministic export sorted by block order', () => {
    const exported = buildTemplateExport(
      record(),
      sampleBlocks,
      1_700_000_000_000,
    )
    expect(exported.schema).toBe('sheetbase-template-export')
    expect(exported.schemaVersion).toBe(1)
    expect(exported.template.identifier).toBe('PRT-2026-0001')
    expect(exported.template.metadataVersion).toBe(3)
    expect(exported.template.properties).toEqual({ version: '1.0' })
    expect(exported.blocks.map((b) => b.order)).toEqual([1, 2])
    expect(exported.blocks[0].type).toBe('checklist')
  })

  it('exports an empty block list when the template has no blocks', () => {
    const exported = buildTemplateExport(record(), [])
    expect(exported.blocks).toEqual([])
  })
})

describe('TPL-001 archiveTemplate / duplicateTemplate RPC wiring', () => {
  afterEach(() => vi.restoreAllMocks())

  it('calls archive_record with the record id and metadata version', async () => {
    const rpc = vi.fn().mockResolvedValue(record({ archivedAt: '2026-03-01' }))
    await archiveTemplate({ rpc } as never, 't-1', 3)
    expect(rpc).toHaveBeenCalledWith('archive_record', {
      p_record_id: 't-1',
      p_expected_metadata_version: 3,
    })
  })

  it('refuses to duplicate a legacy notebook template record', () => {
    const rpc = vi.fn()
    expect(() =>
      duplicateTemplate({ rpc } as never, {
        template: record({
          kind: 'notebook_template',
          identifier: 'NBK-2026-0001',
          status: 'validated',
        }),
        blocks: sampleBlocks,
        targetProjectId: 'p-1',
        title: 'Copy',
      }),
    ).toThrow(/createNotebookTemplate/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('calls create_record_with_blocks with ordered blocks and draft status', async () => {
    const rpc = vi.fn().mockResolvedValue({ record: record(), blocks: [] })
    await duplicateTemplate({ rpc } as never, {
      template: record({
        kind: 'protocol_template',
        identifier: 'PRT-2026-0001',
      }),
      blocks: sampleBlocks,
      targetProjectId: 'p-1',
      title: 'Copy',
    })
    expect(rpc).toHaveBeenCalledWith('create_record_with_blocks', {
      p_project_id: 'p-1',
      p_kind: 'protocol_template',
      p_title: 'Copy',
      p_status: 'draft',
      p_tags: ['stability'],
      p_blocks: [
        expect.objectContaining({ type: 'checklist', order: 1 }),
        expect.objectContaining({ type: 'rich_text', order: 2 }),
      ],
      p_properties: { version: '1.0' },
    })
  })
})

describe('fetchTemplates search filter', () => {
  afterEach(() => vi.restoreAllMocks())

  it('emits a proxy-safe or() ilike filter for search terms', async () => {
    const list = vi.fn().mockResolvedValue([])
    await fetchTemplates({ list } as never, { search: 'titration' })
    const query = list.mock.calls[0][1] as string
    expect(query).toContain(
      'or=(identifier.ilike.*titration*,title.ilike.*titration*)',
    )
    // The /api/db proxy validator must accept the whole query.
    expect(() => sanitizeQuery(query)).not.toThrow()
  })

  it('strips commas and wildcards from the search term before filtering', async () => {
    const list = vi.fn().mockResolvedValue([])
    await fetchTemplates({ list } as never, { search: 'titration,*' })
    const query = list.mock.calls[0][1] as string
    expect(query).toContain(
      'or=(identifier.ilike.*titration*,title.ilike.*titration*)',
    )
    expect(() => sanitizeQuery(query)).not.toThrow()
  })

  it('omits the or() filter entirely when there is no search term', async () => {
    const list = vi.fn().mockResolvedValue([])
    await fetchTemplates({ list } as never, { search: '   ' })
    const query = list.mock.calls[0][1] as string
    expect(query).not.toContain('or=(')
    expect(() => sanitizeQuery(query)).not.toThrow()
  })
})

describe('TPL-001 fetchTemplateUsage', () => {
  afterEach(() => vi.restoreAllMocks())

  it('maps incoming template links to usage items with revision id', async () => {
    const list = vi.fn().mockResolvedValue([
      {
        id: 'l-1',
        source_record_id: 'r-1',
        link_metadata: { template_revision_id: 'rev-9' },
        created_at: '2026-01-03T00:00:00Z',
      },
    ])
    const items = await fetchTemplateUsage({ list } as never, 't-1')
    expect(list).toHaveBeenCalledWith(
      'record_links',
      expect.stringContaining('target_record_id=eq.t-1'),
    )
    expect(items).toHaveLength(1)
    expect(items[0].recordId).toBe('r-1')
    expect(items[0].templateRevisionId).toBe('rev-9')
  })

  it('tolerates a missing template_revision_id', () => {
    const item = toTemplateUsageItem({
      id: 'l-2',
      source_record_id: 'r-2',
      link_metadata: null,
      created_at: '2026-01-04T00:00:00Z',
    })
    expect(item.templateRevisionId).toBeNull()
  })
})

describe('TPL-001 canManageTemplate', () => {
  it('allows the author to manage their template', () => {
    expect(
      canManageTemplate(record({ createdByUserId: 'u-1' }), 'u-1', 'member'),
    ).toBe(true)
  })

  it('allows a workspace owner to manage any template', () => {
    expect(
      canManageTemplate(record({ createdByUserId: 'u-other' }), 'u-1', 'owner'),
    ).toBe(true)
  })

  it('allows a workspace admin to manage any template', () => {
    expect(
      canManageTemplate(record({ createdByUserId: 'u-other' }), 'u-1', 'admin'),
    ).toBe(true)
  })

  it('denies a non-managing member who is not the author', () => {
    expect(
      canManageTemplate(
        record({ createdByUserId: 'u-other' }),
        'u-1',
        'member',
      ),
    ).toBe(false)
  })

  it('denies when there is no current user', () => {
    expect(canManageTemplate(record(), null, 'owner')).toBe(false)
  })
})

describe('TPL-001 archiveDependencyWarning', () => {
  it('returns null when the template is unused', () => {
    expect(archiveDependencyWarning(0)).toBeNull()
  })

  it('returns a singular warning for one use', () => {
    expect(archiveDependencyWarning(1)).toMatch(/used 1 time/)
  })

  it('returns a plural warning for multiple uses', () => {
    expect(archiveDependencyWarning(4)).toMatch(/used 4 times/)
  })
})

describe('TPL-001 createTemplateFavouritesStore', () => {
  function makeStore(initial: string[] = []) {
    const storage = new Map<string, string>([
      [templateFavouritesStorageKey('ws-1', 'u-1'), JSON.stringify(initial)],
    ])
    const mockStorage = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
      key: () => null,
      length: storage.size,
    } as unknown as Storage
    return createTemplateFavouritesStore({
      workspaceId: 'ws-1',
      userId: 'u-1',
      storage: mockStorage,
    })
  }

  it('lists favourites from storage', () => {
    expect(makeStore(['t-1', 't-2']).list()).toEqual(['t-1', 't-2'])
  })

  it('has() reflects stored favourites', () => {
    const store = makeStore(['t-1'])
    expect(store.has('t-1')).toBe(true)
    expect(store.has('t-2')).toBe(false)
  })

  it('toggle() adds a new favourite and returns true', () => {
    const store = makeStore([])
    expect(store.toggle('t-1')).toBe(true)
    expect(store.has('t-1')).toBe(true)
  })

  it('toggle() removes an existing favourite and returns false', () => {
    const store = makeStore(['t-1'])
    expect(store.toggle('t-1')).toBe(false)
    expect(store.has('t-1')).toBe(false)
  })

  it('tolerates corrupted storage by returning an empty list', () => {
    const storage = new Map<string, string>([
      [templateFavouritesStorageKey('ws-1', 'u-1'), 'not-json'],
    ])
    const mockStorage = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
      key: () => null,
      length: storage.size,
    } as unknown as Storage
    const store = createTemplateFavouritesStore({
      workspaceId: 'ws-1',
      userId: 'u-1',
      storage: mockStorage,
    })
    expect(store.list()).toEqual([])
  })

  it('keys favourites per user and workspace', () => {
    expect(templateFavouritesStorageKey('ws-1', 'u-1')).toBe(
      'sheetbase-template-favourites-v1:ws-1:u-1',
    )
  })
})
