import { describe, expect, it } from 'vitest'

import {
  changedRevisionFixture,
  revisionFixture,
  technicalChurnRevisionFixture,
} from './revision-diff.test-fixtures'
import { diffRevisionEnvelopes } from './revision-diff'

describe('diffRevisionEnvelopes', () => {
  it('returns no meaningful changes for identical content or technical churn', () => {
    expect(diffRevisionEnvelopes(revisionFixture(), revisionFixture())).toEqual(
      {
        changes: [],
        counts: { added: 0, removed: 0, modified: 0, moved: 0 },
        tableSummaries: [],
        unchanged: true,
      },
    )
    expect(
      diffRevisionEnvelopes(revisionFixture(), technicalChurnRevisionFixture())
        .unchanged,
    ).toBe(true)
  })

  it('compares metadata, text and checklist state through reviewer values', () => {
    const diff = diffRevisionEnvelopes(
      revisionFixture(),
      changedRevisionFixture(),
    )

    expect(diff.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          area: 'metadata',
          kind: 'modified',
          path: ['title'],
          before: 'Virus stability',
          after: 'Virus stability at 4 °C',
        }),
        expect.objectContaining({
          area: 'text',
          identity: 'block-text',
          before: 'Stored at 4 °C for 28 days.',
          after: 'Stored at 4 °C for 35 days.',
        }),
        expect.objectContaining({
          area: 'checklists',
          identity: 'block-checklist:text:Inspect plate:0',
          path: ['checked'],
          before: false,
          after: true,
        }),
      ]),
    )
  })

  it('uses stable block identities for add, remove and move changes', () => {
    const diff = diffRevisionEnvelopes(
      revisionFixture(),
      changedRevisionFixture(),
    )

    expect(diff.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          area: 'blocks',
          kind: 'added',
          identity: 'block-added',
        }),
        expect.objectContaining({
          area: 'blocks',
          kind: 'removed',
          identity: 'block-remove',
        }),
        expect.objectContaining({
          area: 'blocks',
          kind: 'moved',
          identity: 'block-results',
          beforeOrder: 2,
          afterOrder: 0,
        }),
      ]),
    )
    expect(
      diff.changes.some(
        (change) =>
          change.identity === 'block-results' &&
          (change.kind === 'added' || change.kind === 'removed'),
      ),
    ).toBe(false)
  })

  it('fails closed when a canonical entity has no stable identity', () => {
    const invalid = revisionFixture()
    invalid.blocks.push({
      type: 'note',
      order: 4,
      payload: { text: 'Unidentifiable' },
    } as never)
    expect(() => diffRevisionEnvelopes(revisionFixture(), invalid)).toThrow(
      /stable string identity/,
    )
  })

  it('keeps id-less checklist items stable across insertion and reordering', () => {
    const after = revisionFixture()
    after.blocks[1].payload = {
      items: [
        { text: 'Record temperature', checked: false },
        { text: 'Inspect plate', checked: true },
      ],
    }
    const checklist = diffRevisionEnvelopes(
      revisionFixture(),
      after,
    ).changes.filter((change) => change.area === 'checklists')

    expect(checklist).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'added',
          identity: 'block-checklist:text:Record temperature:0',
        }),
        expect.objectContaining({
          kind: 'modified',
          identity: 'block-checklist:text:Inspect plate:0',
          path: ['checked'],
        }),
      ]),
    )
    expect(checklist).toHaveLength(2)
  })

  it('reports a column reorder as a move without a duplicate modification', () => {
    const before = revisionFixture()
    const after = revisionFixture()
    const columns = after.scientificTables[0].columns as Array<
      Record<string, unknown>
    >
    columns[0].display_order = 1
    columns[1].display_order = 0
    after.scientificTables[0].columns = [columns[1], columns[0]]

    const columnChanges = diffRevisionEnvelopes(before, after).changes.filter(
      (change) => change.columnId,
    )
    expect(columnChanges).toHaveLength(1)
    expect(columnChanges[0]).toMatchObject({ kind: 'moved' })
  })

  it('treats calculation input revision as scientific evidence', () => {
    const before = revisionFixture()
    const after = revisionFixture()
    before.record.calculationInputRevision = 4
    after.record.calculationInputRevision = 5
    expect(diffRevisionEnvelopes(before, after).changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          area: 'metadata',
          path: ['calculationInputRevision'],
          before: 4,
          after: 5,
        }),
      ]),
    )
  })

  it('compares links by their stable identity', () => {
    const diff = diffRevisionEnvelopes(
      revisionFixture(),
      changedRevisionFixture(),
    )
    expect(diff.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          area: 'links',
          identity: 'link-1',
          path: ['linkMetadata', 'role'],
          before: 'test article',
          after: 'reference standard',
        }),
      ]),
    )
  })

  it('summarises table changes and retains exact cell values and units', () => {
    const diff = diffRevisionEnvelopes(
      revisionFixture(),
      changedRevisionFixture(),
    )
    const summary = diff.tableSummaries[0]
    const cell = summary.changes.find(
      (change) => change.identity === 'table-1:row-2:column-titer',
    )

    expect(summary).toMatchObject({
      tableId: 'table-1',
      label: 'Timepoints',
      addedRows: 1,
      removedRows: 0,
      modifiedCells: 1,
    })
    expect(cell).toMatchObject({
      kind: 'modified',
      before: '9.5000E+05',
      after: '1.0250E+06',
      beforeUnit: 'TU/mL',
      afterUnit: 'TU/mL',
    })
  })

  it('preserves exact formula text and compares file evidence', () => {
    const diff = diffRevisionEnvelopes(
      revisionFixture(),
      changedRevisionFixture(),
    )
    expect(diff.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          area: 'formulas',
          identity: 'formula-1',
          path: ['formula_text'],
          before: '=ROUND([titer] * 1.000E+00, 4)',
          after: '=ROUND([titer] * 1.250E+00, 4)',
        }),
        expect.objectContaining({
          area: 'files',
          identity: 'file-1',
          path: ['checksum'],
          before: 'aaa111',
          after: 'bbb222',
        }),
      ]),
    )
  })

  it('produces the same ordered result for the same envelopes', () => {
    const before = revisionFixture()
    const after = changedRevisionFixture()
    expect(diffRevisionEnvelopes(before, after)).toEqual(
      diffRevisionEnvelopes(before, after),
    )
  })

  it('diffs scientific-table cells when columns are serialized with field_name (real DB shape)', () => {
    // The canonical snapshot built by internal.build_revision_envelope
    // serializes scientific_columns with to_jsonb(column_row), so each column
    // carries `field_name` (the physical API column), not `api_name`. A cell
    // edit must still surface as a modifiedCells change with the field_name
    // key resolving the row value.
    const before = revisionFixture()
    const after = changedRevisionFixture()
    const tableBefore = before.scientificTables[0]
    const tableAfter = after.scientificTables[0]
    const toFieldName = (columns: unknown) =>
      (columns as Array<Record<string, unknown>>).map((column) => {
        const { api_name, ...rest } = column
        return { ...rest, field_name: api_name }
      })
    tableBefore.columns = toFieldName(tableBefore.columns)
    tableAfter.columns = toFieldName(tableAfter.columns)
    // Re-key the dynamic rows to match the renamed columns.
    tableBefore.rows = [
      { id: 'row-1', timepoint: '0', titer: '1.2300E+06' },
      { id: 'row-2', timepoint: '7', titer: '9.5000E+05' },
    ]
    tableAfter.rows = [
      { id: 'row-1', timepoint: '0', titer: '1.2300E+06' },
      { id: 'row-2', timepoint: '7', titer: '1.0250E+06' },
      { id: 'row-3', timepoint: '14', titer: '8.1000E+05' },
    ]

    const diff = diffRevisionEnvelopes(before, after)
    const summary = diff.tableSummaries[0]
    const cell = summary.changes.find(
      (change) => change.identity === 'table-1:row-2:column-titer',
    )

    expect(summary).toMatchObject({
      tableId: 'table-1',
      addedRows: 1,
      modifiedCells: 1,
    })
    expect(cell).toMatchObject({
      kind: 'modified',
      before: '9.5000E+05',
      after: '1.0250E+06',
    })
  })
})
