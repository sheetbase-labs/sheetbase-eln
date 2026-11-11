import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { SheetBenchEntry } from '#/components/sheet/sheet-bench-entry'
import {
  SheetMoreMenu,
  SheetSaveStatus,
} from '#/components/sheet/sheet-toolbar-parts'
import type { SheetbaseGridCellValue } from '#/components/sheet/sheetbase-grid'
import type { CanonicalSheetGridColumn } from '#/lib/canonical-sheet-grid'
import type { FieldDefinition } from '#/lib/field-definition'

/**
 * The sheet's everyday toolbar pieces and Bench entry: the one save line,
 * the More menu, and one run typed as large fields. Turbidity states a
 * 0–50 NTU range, so a value above it is explained under the field; the
 * calculated column is locked and says why.
 */
function field(key: string, label: string, unit?: string): FieldDefinition {
  return {
    fieldId: `field-${key}`,
    key,
    label,
    description: null,
    logicalType: 'decimal',
    nullable: true,
    defaultValue: null,
    cardinality: 'one',
    quantity: unit
      ? {
          kind: key,
          dimension: key,
          storageUnit: unit,
          preferredDisplayUnit: unit,
        }
      : null,
    validation: key === 'turbidity' ? { min: 0, max: 50 } : {},
    category: null,
    relationship: null,
    computation: { mode: 'stored' },
    lifecycle: 'active',
  }
}

function column(
  key: string,
  label: string,
  options: { unit?: string; calculated?: boolean; text?: boolean } = {},
): CanonicalSheetGridColumn {
  return {
    id: key,
    label,
    origin: options.calculated ? 'calculation' : 'local',
    field: field(key, label, options.unit),
    presentation: options.text
      ? { kind: 'text', inputType: 'text' }
      : { kind: 'number', inputType: 'number', step: 'any' },
    editable: !options.calculated,
    group: 'This experiment',
  }
}

const COLUMNS: CanonicalSheetGridColumn[] = [
  column('filter_train', 'Filter train', { text: true }),
  column('load', 'Load', { unit: 'L/m²' }),
  column('turbidity', 'Turbidity', { unit: 'NTU' }),
  column('capsid_titre', 'Capsid titre', { unit: 'cp/mL' }),
  column('adj_yield', 'Adj. yield', { calculated: true }),
]

const ROWS: SheetbaseGridCellValue[][] = [
  ['B-150', 150, 12.8, 7.3e11, 84],
  ['C-150', 150, 61.5, 5.4e11, null],
]

function BenchEntryDemo({ canWrite = true }: { canWrite?: boolean }) {
  const [row, setRow] = useState(0)

  return (
    <SheetBenchEntry
      columns={COLUMNS}
      gridColumns={[]}
      rowIndex={row}
      rowCount={ROWS.length}
      values={ROWS[row] ?? []}
      canWrite={canWrite}
      saving={false}
      onSave={() => undefined}
      onMove={setRow}
    />
  )
}

const meta = {
  title: 'Sheet/Bench entry',
  component: BenchEntryDemo,
} satisfies Meta<typeof BenchEntryDemo>

export default meta

type Story = StoryObj<typeof meta>

/** One run as large fields, with its range beside Turbidity. */
export const BenchEntry: Story = {}

/** A viewer sees the run but every field says why it is locked. */
export const ViewOnly: Story = { args: { canWrite: false } }

/** The save line in each of its states. */
export const SaveLine: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-2">
      <SheetSaveStatus state="saved" />
      <SheetSaveStatus state="saving" />
      <SheetSaveStatus state="failed" detail="The server did not answer" />
      <SheetSaveStatus state="read-only" />
    </div>
  ),
}

/** The More menu that holds the less frequent tools. */
export const MoreMenu: Story = {
  render: () => (
    <SheetMoreMenu
      groups={[
        {
          id: 'add',
          label: 'Add',
          items: [
            { id: 'row', label: 'Add row', icon: 'plus', onSelect: () => {} },
            { id: 'paste', label: 'Paste data…', onSelect: () => {} },
          ],
        },
        {
          id: 'download',
          label: 'Download',
          items: [{ id: 'csv', label: 'CSV', onSelect: () => {} }],
        },
      ]}
    />
  ),
}
