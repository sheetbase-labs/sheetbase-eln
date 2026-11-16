import { describe, expect, it } from 'vitest'

import { canonicalSheetGridMatrix } from './canonical-sheet-grid'
import type { ComposedSheetSnapshot } from './sheet-composition-data'
import { validSheetInstanceState } from './sheet-instance.test'
import { validSheetDefinitionConfiguration } from '../../tests/fixtures/sheet-definition'

const instanceId = '20000000-0000-4000-8000-000000000001'
const rowA = '30000000-0000-4000-8000-0000000000a1'
const rowB = '30000000-0000-4000-8000-0000000000a2'

/** A Definition whose rows are typed in: two typed columns and one calculated. */
function typedInSnapshot(): ComposedSheetSnapshot {
  const configuration = validSheetDefinitionConfiguration()
  const [first, second, calculated] = configuration.columns

  return {
    instanceId,
    revision: 1,
    offset: 0,
    limit: 50,
    hasMore: false,
    localFieldIds: [],
    identity: {
      kind: 'local',
      columnIds: [first.id],
      logicalTypes: ['reference'],
    },
    definitionConfiguration: {
      ...configuration,
      columns: [
        { ...first, source: { kind: 'declared' } },
        { ...second, source: { kind: 'declared' } },
        calculated,
      ],
    },
    rows: [],
  }
}

describe('canonicalSheetGridMatrix with typed-in rows', () => {
  it('shows the Definition columns and the rows people typed', () => {
    const snapshot = typedInSnapshot()

    const [first, second, calculated] =
      snapshot.definitionConfiguration!.columns

    const state = validSheetInstanceState()

    state.localFields = []
    state.localValues = { [rowA]: { [first.id]: 'a', [second.id]: 'b' } }
    state.localValues[rowB] = { [first.id]: 'c' }

    const calculationId =
      calculated.source.kind === 'calculated'
        ? calculated.source.calculationId
        : ''

    const matrix = canonicalSheetGridMatrix({
      instance: {
        id: instanceId,
        workspaceId: '20000000-0000-4000-8000-000000000002',
        projectId: null,
        notebookRecordId: null,
        sourceDefinitionVersionId: '20000000-0000-4000-8000-000000000009',
        name: 'Typed rows',
        description: null,
        lifecycle: 'active',
        revision: 1,
        state,
        duplicatedFromInstanceId: null,
        createdAt: '2026-11-16T12:00:00.000Z',
        updatedAt: '2026-11-16T12:00:00.000Z',
        createdByUserId: 'u1',
        updatedByUserId: 'u1',
      },
      composition: snapshot,
      calculationResults: { [rowA]: { [calculationId]: 42 } },
    })

    expect(
      matrix.columns.map(({ id, origin, editable }) => [id, origin, editable]),
    ).toEqual([
      [first.id, 'local', true],
      [second.id, 'local', true],
      [calculated.id, 'calculation', false],
    ])

    expect(matrix.rowKeys).toEqual([rowA, rowB])
    expect(matrix.rowKinds).toEqual(['local', 'local'])

    // Typed cells come from the sheet's own values; a calculated cell comes
    // from the calculation its column is wired to.
    expect(matrix.data).toEqual([
      ['a', 'b', 42],
      ['c', null, null],
    ])
  })
})
