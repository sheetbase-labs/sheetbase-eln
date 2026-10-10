import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CanonicalSheetGridColumn } from '#/lib/canonical-sheet-grid'
import type { FieldDefinition } from '#/lib/field-definition'
import type { BoundValueState } from '#/lib/sheet-bound-columns'

import {
  canonicalCellFacts,
  NotebookInspector,
} from './notebook-inspector'
import type { NotebookInspectorCellFacts } from './notebook-inspector'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
  }: {
    to: string
    search?: unknown
    params?: unknown
    children: React.ReactNode
  }) => <a href={to}>{children}</a>,
}))

afterEach(() => cleanup())

const FULL_FACTS: NotebookInspectorCellFacts = {
  subject: 'Clarification runs · row 9 · Turbidity out',
  value: { display: '61.5', unit: 'NTU' },
  validation: {
    state: 'error',
    headline: 'Outside allowed range',
    detail: 'Allowed 0–50 NTU. Repeat the reading at a higher dilution.',
    rule: 'Allowed 0–50',
  },
  provenance: {
    dataset: {
      label: 'DS-0311',
      datasetId: 'ds-0311',
      rowLabel: '88',
    },
    instrument: 'Turbidimeter TB-02',
    capturedAt: '24 Sep 2026, 16:04',
    enteredBy: 'Import, PR-01 export',
    editedAt: null,
  },
  column: {
    field: 'Turbidity out',
    type: 'Decimal',
    unit: 'NTU',
    validation: 'Allowed 0–50',
    required: true,
    source: 'Linked',
  },
}

describe('NotebookInspector tabs', () => {
  it('switches between Properties, Comments and History', async () => {
    const user = userEvent.setup()
    render(
      <NotebookInspector
        cell={FULL_FACTS}
        comments={<p>Block and row threads</p>}
        history={<p>Record history</p>}
      />,
    )

    const properties = screen.getByRole('tab', { name: 'Properties' })
    expect(properties.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('61.5', { exact: false })).toBeTruthy()
    expect(screen.queryByText('Block and row threads')).toBeNull()

    await user.click(screen.getByRole('tab', { name: 'Comments' }))
    expect(screen.getByText('Block and row threads')).toBeTruthy()
    expect(screen.queryByText('Record history')).toBeNull()

    await user.click(screen.getByRole('tab', { name: 'History' }))
    expect(screen.getByText('Record history')).toBeTruthy()
    expect(screen.queryByText('Block and row threads')).toBeNull()
  })

  it('makes every tab reachable by keyboard', async () => {
    const user = userEvent.setup()
    render(<NotebookInspector cell={FULL_FACTS} />)

    await user.tab()
    const properties = screen.getByRole('tab', { name: 'Properties' })
    expect(document.activeElement).toBe(properties)

    await user.keyboard('{ArrowRight}')
    const comments = screen.getByRole('tab', { name: 'Comments' })
    expect(document.activeElement).toBe(comments)

    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(
      screen.getByRole('tab', { name: 'History' }),
    )
  })
})

describe('NotebookInspector Properties', () => {
  it('renders the facts it has', () => {
    render(<NotebookInspector cell={FULL_FACTS} />)

    expect(
      screen.getByText('Clarification runs · row 9 · Turbidity out'),
    ).toBeTruthy()

    // Value and unit.
    const value = screen.getByText('61.5', { exact: false })
    expect(value.textContent).toContain('NTU')

    // Validation state.
    expect(screen.getByText('Outside allowed range')).toBeTruthy()
    expect(
      screen.getByText('Allowed 0–50 NTU. Repeat the reading at a higher dilution.'),
    ).toBeTruthy()

    // Provenance.
    const provenance = screen.getByRole('heading', { name: 'Provenance' })
      .parentElement?.parentElement as HTMLElement
    expect(within(provenance).getByText('DS-0311')).toBeTruthy()
    expect(within(provenance).getByText(/row 88/)).toBeTruthy()
    expect(
      within(provenance).getByText('Turbidimeter TB-02'),
    ).toBeTruthy()
    expect(within(provenance).getByText('24 Sep 2026, 16:04')).toBeTruthy()
    expect(within(provenance).getByText('Import, PR-01 export')).toBeTruthy()

    // Column definition.
    const column = screen.getByRole('heading', { name: 'Column' })
      .parentElement?.parentElement as HTMLElement
    expect(within(column).getByText('Turbidity out')).toBeTruthy()
    expect(within(column).getByText('Decimal')).toBeTruthy()
    expect(within(column).getByText('NTU')).toBeTruthy()
    expect(within(column).getByText('Yes')).toBeTruthy()
    expect(within(column).getByText('Linked')).toBeTruthy()
  })

  it('names the facts it lacks instead of showing placeholders', () => {
    render(
      <NotebookInspector
        cell={{
          value: { display: null },
          validation: null,
          provenance: {
            dataset: null,
            instrument: null,
            capturedAt: null,
            enteredBy: null,
            editedAt: null,
          },
          column: null,
        }}
      />,
    )

    expect(screen.getByText('No value recorded')).toBeTruthy()
    expect(
      screen.getByText('No validation rule is recorded for this cell.'),
    ).toBeTruthy()
    expect(
      screen.getByText('No actions are available for this cell.'),
    ).toBeTruthy()
    expect(screen.getByText('This cell has no column definition.')).toBeTruthy()
    // Dataset, Instrument, Captured, Entered by and Edited are all named.
    expect(screen.getAllByText('Not available')).toHaveLength(5)
  })

  it('names an absent provenance section when the cell is not composed', () => {
    render(
      <NotebookInspector
        cell={{ value: { display: 'x' }, validation: null, provenance: null }}
      />,
    )
    expect(
      screen.getByText('Provenance is not available for this cell.'),
    ).toBeTruthy()
  })

  it('says nothing is selected when there is no cell', () => {
    render(<NotebookInspector />)
    expect(
      screen.getByText(
        'Nothing is selected. Choose a cell to see its properties.',
      ),
    ).toBeTruthy()
  })
})

describe('canonicalCellFacts', () => {
  const field: FieldDefinition = {
    fieldId: 'f1',
    key: 'turbidity_out',
    label: 'Turbidity out',
    description: null,
    logicalType: 'decimal',
    nullable: false,
    defaultValue: null,
    cardinality: 'one',
    quantity: {
      kind: 'turbidity',
      dimension: 'turbidity',
      storageUnit: 'NTU',
      preferredDisplayUnit: 'NTU',
    },
    validation: { min: 0, max: 50 },
    category: null,
    relationship: null,
    computation: { mode: 'stored' },
    lifecycle: 'active',
  }

  const column: CanonicalSheetGridColumn = {
    id: 'c1',
    label: 'Turbidity out',
    origin: 'bound',
    field,
    presentation: { kind: 'number', inputType: 'number', step: 'any' },
    editable: true,
  }

  const valueState: BoundValueState = {
    kind: 'present',
    value: 61.5,
    provenance: {
      definitionVersionId: 'dv1',
      definitionColumnId: 'c1',
      bindingId: 'b1',
      sourceFieldId: 'f1',
      sourceKind: 'dataset',
      sourceDatasetId: 'ds-0311',
      sourceRowId: 'row-88',
      sourceRevision: null,
      sourceDatasetRevision: 3,
    },
  }

  it('maps an out-of-range bound value to honest facts', () => {
    const facts = canonicalCellFacts({
      column,
      value: 61.5,
      valueState,
      rowLabel: 'row 9',
    })

    expect(facts.value).toEqual({ display: '61.5', unit: 'NTU' })
    expect(facts.validation?.state).toBe('error')
    expect(facts.validation?.headline).toBe('Above the allowed range')
    expect(facts.provenance?.dataset).toEqual({
      label: 'ds-0311',
      datasetId: 'ds-0311',
      rowLabel: 'row-88',
    })
    // The model carries no instrument, capture time or edit actors.
    expect(facts.provenance?.instrument).toBeNull()
    expect(facts.provenance?.editedAt).toBeNull()
    expect(facts.column).toMatchObject({
      field: 'Turbidity out',
      type: 'Decimal',
      unit: 'NTU',
      validation: 'Allowed 0–50',
      required: true,
      source: 'Linked',
    })
  })

  it('leaves provenance absent for a local column with no bound state', () => {
    const facts = canonicalCellFacts({ column: null, value: 'hello' })
    expect(facts.provenance).toBeNull()
    expect(facts.column).toBeNull()
  })
})
