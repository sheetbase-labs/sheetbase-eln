import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { SheetProvenanceLine } from '#/components/sheet/canonical-sheet-workspace'
import type { BoundColumnProvenance } from '#/lib/sheet-bound-columns'

/**
 * NAV-02 sheet footer provenance. A bound column names where its value comes
 * from and links to that canonical object; the link resolves through the
 * Storybook TanStack router, so the destination is real.
 */
const datasetProvenance = {
  sourceKind: 'dataset',
  sourceDatasetId: '770e8400-e29b-41d4-a716-446655440020',
  sourceRowId: null,
  sourceRevision: 3,
  sourceDatasetRevision: 9,
  bindingId: 'binding-1',
  sourceFieldId: 'field-1',
  definitionVersionId: 'def-1',
  definitionColumnId: 'col-1',
} as unknown as BoundColumnProvenance

const recordProvenance = {
  sourceKind: 'record',
  sourceRecordId: '660e8400-e29b-41d4-a716-446655440010',
  sourceMetadataVersion: 5,
  sourceFieldName: 'titer',
  bindingId: 'binding-1',
  sourceFieldId: 'field-1',
} as unknown as BoundColumnProvenance

const meta = {
  title: 'Sheet/Provenance line',
  component: SheetProvenanceLine,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[560px] text-xs text-fg-muted">
        <Story />
      </div>
    ),
  ],
  args: {
    columnLabel: 'Titer',
    columnOrigin: 'bound',
    provenance: { kind: 'present', provenance: datasetProvenance },
  },
} satisfies Meta<typeof SheetProvenanceLine>
export default meta
type Story = StoryObj<typeof meta>

/** A Dataset-bound column links to the Dataset explorer. */
export const DatasetBound: Story = {}

/** A Record-bound column links to the owning Record. */
export const RecordBound: Story = {
  args: { provenance: { kind: 'present', provenance: recordProvenance } },
}

/** A local column states that it is local, with nothing to link. */
export const LocalColumn: Story = {
  args: {
    columnLabel: 'Observation',
    columnOrigin: 'local',
    provenance: null,
  },
}

/** A calculation column says so rather than claiming governed provenance. */
export const CalculationColumn: Story = {
  args: {
    columnLabel: 'Normalised',
    columnOrigin: 'calculation',
    provenance: null,
  },
}

/** A binding whose source no longer matches states “unmatched source”. */
export const UnmatchedSource: Story = {
  args: { provenance: { kind: 'unmatched', provenance: { legacy: true } } },
}
