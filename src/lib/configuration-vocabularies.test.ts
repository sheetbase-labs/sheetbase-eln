import { describe, expect, it, vi } from 'vitest'

import {
  collectDefinitionVocabularies,
  loadConfigurationVocabularies,
  normalizeConfigurationVocabularies,
} from '#/lib/configuration-vocabularies'
import type { DataClient } from '#/lib/data-client'
import type { ConfigurationVocabulary } from '#/lib/configuration-vocabularies'
import type { SheetDefinitionConfiguration } from '#/lib/sheet-definition'

function embeddedCategoryField(
  columnId: string,
  fieldId: string,
  key: string,
  label: string,
  options: Array<{
    id: string
    key: string
    label: string
    lifecycle?: 'active' | 'retired'
  }>,
) {
  return {
    id: columnId,
    field: {
      fieldId,
      key,
      label,
      description: null,
      logicalType: 'category' as const,
      nullable: true,
      defaultValue: null,
      cardinality: 'one' as const,
      quantity: null,
      validation: {},
      category: {
        kind: 'embedded' as const,
        options: options.map((option, index) => ({
          id: option.id,
          key: option.key,
          label: option.label,
          displayOrder: index,
          lifecycle: option.lifecycle ?? 'active',
        })),
      },
      relationship: null,
      computation: { mode: 'stored' as const },
      lifecycle: 'active' as const,
    },
    source: { kind: 'declared' as const },
  }
}

describe('configuration vocabularies', () => {
  it('collects embedded category columns from sheet definition configuration', () => {
    const configuration: SheetDefinitionConfiguration = {
      formatVersion: 1,
      parameters: [],
      bindings: [],
      rowIdentity: { kind: 'local', columnIds: ['col-1'] },
      joins: [],
      columns: [
        embeddedCategoryField('col-1', 'field-1', 'status', 'Status', [
          { id: 'opt-1', key: 'open', label: 'Open' },
          { id: 'opt-2', key: 'closed', label: 'Closed' },
        ]),
      ],
      calculations: [],
      writeBackRules: [],
      actions: [],
      presentation: {
        columnOrder: ['col-1'],
        hiddenColumnIds: [],
        columnWidths: {},
        frozenColumnCount: 0,
        density: 'standard',
        filters: [],
        sorts: [],
      },
    }
    const items = collectDefinitionVocabularies(
      'def-1',
      'Stability sheet',
      configuration,
    )
    expect(items).toEqual([
      {
        id: 'definition:col-1',
        label: 'Status',
        sourceKind: 'definition',
        sourceId: 'def-1',
        sourceLabel: 'Stability sheet',
        fieldKey: 'status',
        categoryKind: 'embedded',
        vocabularyId: null,
        terms: [
          { id: 'opt-1', key: 'open', label: 'Open', lifecycle: 'active' },
          { id: 'opt-2', key: 'closed', label: 'Closed', lifecycle: 'active' },
        ],
      },
    ])
  })

  it('normalises vocabulary labels for catalogue display', () => {
    const items: ConfigurationVocabulary[] = [
      {
        id: 'schema:2',
        label: 'Zebra',
        sourceKind: 'schema',
        sourceId: 'schema-2',
        sourceLabel: 'Schema B',
        fieldKey: 'z',
        categoryKind: 'embedded',
        vocabularyId: null,
        terms: [],
      },
      {
        id: 'schema:1',
        label: 'Alpha',
        sourceKind: 'schema',
        sourceId: 'schema-1',
        sourceLabel: 'Schema A',
        fieldKey: 'a',
        categoryKind: 'embedded',
        vocabularyId: null,
        terms: [],
      },
    ]
    expect(
      normalizeConfigurationVocabularies(items).map((item) => item.label),
    ).toEqual(['Alpha', 'Zebra'])
  })

  it('loads a bounded vocabulary page from the governed index', async () => {
    const rpc = vi.fn().mockResolvedValue({
      items: [
        {
          id: 'model:field-1',
          label: 'Status',
          source_kind: 'model',
          source_id: 'sample',
          source_label: 'Samples',
          field_key: 'status',
          category_kind: 'embedded',
          vocabulary_id: null,
          terms: [],
        },
      ],
      hasMore: true,
    })
    const page = await loadConfigurationVocabularies(
      { rpc } as unknown as DataClient,
      'workspace-1',
      200,
    )

    expect(rpc).toHaveBeenCalledWith('list_configuration_vocabularies', {
      p_workspace_id: 'workspace-1',
      p_limit: 200,
      p_offset: 200,
    })
    expect(page).toMatchObject({
      hasMore: true,
      items: [{ id: 'model:field-1', sourceKind: 'model' }],
    })
  })
})
