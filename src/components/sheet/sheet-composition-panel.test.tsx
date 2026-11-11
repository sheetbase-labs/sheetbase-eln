import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { CanonicalSheetGridColumn } from '#/lib/canonical-sheet-grid'
import { fieldEditorPresentation } from '#/lib/field-presentation'

import { SheetCompositionPanel } from './sheet-composition-panel'

function column(
  id: string,
  origin: CanonicalSheetGridColumn['origin'],
  group: string,
  sourceLabel?: string,
): CanonicalSheetGridColumn {
  return {
    id,
    label: id,
    origin,
    group,
    sourceLabel,
    field: null,
    presentation: fieldEditorPresentation('text'),
    editable: origin !== 'calculation',
  }
}

const columns = [
  column('Titre', 'bound', 'Live', 'DS-0311'),
  column('Turbidity', 'bound', 'Live', 'DS-0311'),
  column('Load', 'local', 'This experiment'),
  column('Yield', 'calculation', 'Calculations'),
]

describe('SheetCompositionPanel', () => {
  it('groups columns by what owns them, in sheet order', () => {
    render(
      <SheetCompositionPanel columns={columns} rowsMatchedOn={[]} from="" />,
    )

    const items = screen.getAllByRole('listitem')

    expect(
      items.map(
        (item) => item.firstElementChild?.nextSibling?.firstChild?.textContent,
      ),
    ).toEqual(['DS-0311', 'This experiment', 'Calculations'])
    expect(items[0]?.textContent).toContain('Live · Titre, Turbidity')
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('The sheet’s own rows')).toBeTruthy()
  })

  it('offers the sheet’s own columns to a dataset', () => {
    const onAddToDataset = vi.fn()

    render(
      <SheetCompositionPanel
        columns={columns}
        rowsMatchedOn={['Condition']}
        from="Ad hoc, no definition"
        onAddToDataset={onAddToDataset}
      />,
    )

    expect(screen.getByText('Matched on Condition')).toBeTruthy()
    screen.getByRole('button', { name: /Add to dataset/ }).click()
    expect(onAddToDataset).toHaveBeenCalledWith([columns[2]])
  })
})
