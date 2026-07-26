import type { CanonicalRevisionEnvelope } from './revision-diff'

export function revisionFixture(): CanonicalRevisionEnvelope {
  return {
    formatVersion: 1,
    record: {
      id: 'record-1',
      workspaceId: 'workspace-1',
      identifier: 'EXP-2026-001',
      title: 'Virus stability',
      status: 'draft',
      tags: ['stability'],
      metadataVersion: 1,
      updatedAt: '2026-07-25T09:00:00Z',
      updatedByUserId: 'user-1',
    },
    blocks: [
      {
        id: 'block-text',
        type: 'rich_text',
        order: 0,
        version: 1,
        payloadSchemaVersion: 1,
        payload: {
          doc: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', text: 'Stored at 4 °C for 28 days.' },
                ],
              },
            ],
          },
        },
      },
      {
        id: 'block-checklist',
        type: 'checklist',
        order: 1,
        version: 1,
        payloadSchemaVersion: 1,
        payload: {
          items: [{ text: 'Inspect plate', checked: false }],
        },
      },
      {
        id: 'block-results',
        type: 'heading',
        order: 2,
        version: 1,
        payloadSchemaVersion: 1,
        payload: { text: 'Results' },
      },
      {
        id: 'block-remove',
        type: 'note',
        order: 3,
        version: 1,
        payloadSchemaVersion: 1,
        payload: { text: 'Remove after review' },
      },
    ],
    links: [
      {
        id: 'link-1',
        sourceRecordId: 'record-1',
        targetRecordId: 'sample-1',
        targetIdentifier: 'SMP-001',
        linkType: 'uses',
        linkMetadata: { role: 'test article' },
      },
    ],
    scientificTables: [
      {
        id: 'table-1',
        display_name: 'Timepoints',
        schema_version: 1,
        columns: [
          {
            id: 'column-time',
            api_name: 'timepoint',
            display_name: 'Timepoint',
            display_order: 0,
            unit: 'days',
          },
          {
            id: 'column-titer',
            api_name: 'titer',
            display_name: 'Titer',
            display_order: 1,
            unit: 'TU/mL',
          },
        ],
        rows: [
          { id: 'row-1', timepoint: '0', titer: '1.2300E+06' },
          { id: 'row-2', timepoint: '7', titer: '9.5000E+05' },
        ],
      },
    ],
    formulas: [
      {
        id: 'formula-1',
        formula_text: '=ROUND([titer] * 1.000E+00, 4)',
        version: 1,
        target_column_id: 'column-titer',
      },
    ],
    files: [
      {
        id: 'file-1',
        displayName: 'assay-results.csv',
        mediaType: 'text/csv',
        byteSize: 412,
        checksum: 'aaa111',
        storageKey: 'workspace-1/assay-results.csv',
        version: 1,
      },
    ],
  }
}

export function changedRevisionFixture(): CanonicalRevisionEnvelope {
  const revision = structuredClone(revisionFixture())

  revision.record.title = 'Virus stability at 4 °C'
  revision.record.updatedAt = '2026-07-26T10:00:00Z'
  revision.record.metadataVersion = 2

  revision.blocks = [
    {
      ...revision.blocks[2],
      order: 0,
      version: 2,
    },
    {
      ...revision.blocks[0],
      order: 1,
      version: 2,
      payload: {
        doc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Stored at 4 °C for 35 days.' }],
            },
          ],
        },
      },
    },
    {
      ...revision.blocks[1],
      order: 2,
      version: 2,
      payload: {
        items: [{ text: 'Inspect plate', checked: true }],
      },
    },
    {
      id: 'block-added',
      type: 'note',
      order: 3,
      version: 1,
      payloadSchemaVersion: 1,
      payload: { text: 'Reviewer note' },
    },
  ]

  revision.links[0] = {
    ...revision.links[0],
    linkMetadata: { role: 'reference standard' },
  }

  const table = revision.scientificTables[0]
  table.schema_version = 2
  table.rows = [
    { id: 'row-1', timepoint: '0', titer: '1.2300E+06' },
    { id: 'row-2', timepoint: '7', titer: '1.0250E+06' },
    { id: 'row-3', timepoint: '14', titer: '8.1000E+05' },
  ]

  revision.formulas[0] = {
    ...revision.formulas[0],
    version: 2,
    formula_text: '=ROUND([titer] * 1.250E+00, 4)',
  }

  revision.files[0] = {
    ...revision.files[0],
    version: 2,
    checksum: 'bbb222',
  }

  return revision
}

export function technicalChurnRevisionFixture(): CanonicalRevisionEnvelope {
  const revision = structuredClone(revisionFixture())
  revision.record.metadataVersion = 2
  revision.record.updatedAt = '2026-07-26T10:00:00Z'
  revision.record.updatedByUserId = 'user-2'
  revision.blocks[0].version = 2
  revision.blocks[0].updatedAt = '2026-07-26T10:00:00Z'
  revision.formulas[0].version = 2
  revision.files[0].version = 2
  return revision
}
