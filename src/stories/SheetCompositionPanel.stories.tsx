import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { SheetCompositionPanel } from '#/components/sheet/sheet-composition-panel'
import type { CanonicalSheetGridColumn } from '#/lib/canonical-sheet-grid'
import { fieldEditorPresentation } from '#/lib/field-presentation'

/**
 * Details: what a sheet is made of. Each dataset with the columns it brings,
 * the sheet's own columns (which can be offered to a dataset), the
 * calculations, how rows are matched and where the sheet came from.
 */
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

const meta = {
  title: 'Sheet/Composition panel',
  component: SheetCompositionPanel,
  args: {
    columns: [
      column('Turbidity', 'bound', 'Live', 'DS-0311 · ELISA capsid titre'),
      column('Capsid titre', 'bound', 'Live', 'DS-0311 · ELISA capsid titre'),
      column('Condition', 'local', 'This experiment'),
      column('Load', 'local', 'This experiment'),
      column('Step yield', 'calculation', 'Calculations'),
    ],
    rowsMatchedOn: ['Condition'],
    from: 'Definition SD-0012, version 3',
    onAddToDataset: () => {},
  },
} satisfies Meta<typeof SheetCompositionPanel>

export default meta

type Story = StoryObj<typeof meta>

export const Composed: Story = {}

export const AdHoc: Story = {
  args: {
    columns: [column('Condition', 'local', 'This experiment')],
    rowsMatchedOn: [],
    from: 'Ad hoc, no definition',
  },
}
