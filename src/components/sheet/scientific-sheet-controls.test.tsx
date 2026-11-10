import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { t } from '#/copy'
import { scientificTableSchema } from '#/lib/scientific-sheet-data'
import { ScientificColumnForm } from './scientific-sheet-column-form'
import { ScientificFormulaBar } from './scientific-sheet-formula-bar'
import { ScientificSheetFooter } from './scientific-sheet-footer'
import { ScientificSchemaConfirmation } from './scientific-sheet-schema-column'

const table = scientificTableSchema.parse({
  id: '10000000-0000-4000-8000-000000000001',
  name: 'Results',
  resource_name: 'sheet_results',
  schema_version: 1,
  lifecycle: 'active',
  columns: [
    {
      id: '10000000-0000-4000-8000-000000000002',
      field_name: 'result',
      label: 'Result',
      display_order: 1,
      logical_type: 'decimal',
      nullable: true,
      unit: null,
      validation: {},
      width: 120,
      options: [],
    },
  ],
})

afterEach(cleanup)

describe('scientific sheet controls', () => {
  it('associates creation labels with controls and preserves metadata JSON keys', () => {
    const onAdd = vi.fn()
    const onError = vi.fn()
    render(
      <ScientificColumnForm
        disabled={false}
        isAdmin
        onAdd={onAdd}
        onError={onError}
      />,
    )
    fireEvent.change(
      screen.getByLabelText(t('notebook.scientificSheetBlock.label')),
      { target: { value: 'Mass' } },
    )
    fireEvent.change(
      screen.getByLabelText(t('notebook.scientificSheetBlock.unitJson')),
      {
        target: {
          value: '{"symbol":"mg","__proto__":{"scientific":"retained"}}',
        },
      },
    )
    fireEvent.change(
      screen.getByLabelText(t('notebook.scientificSheetBlock.validationJson')),
      { target: { value: '{"min":0,"extension":{"study":"A"}}' } },
    )
    fireEvent.click(
      screen.getByRole('button', {
        name: t('notebook.scientificSheetBlock.addColumn'),
      }),
    )
    expect(onError).not.toHaveBeenCalled()
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Mass',
        unit: JSON.parse(
          '{"symbol":"mg","__proto__":{"scientific":"retained"}}',
        ),
        validation: { min: 0, extension: { study: 'A' } },
      }),
    )
    expect(onAdd.mock.calls[0]?.[0]).not.toHaveProperty('defaultValue')
    expect(screen.getByRole('combobox').id).toBe('new-col-type')
  })

  it('rejects invalid known metadata before submitting a column', () => {
    const onAdd = vi.fn()
    const onError = vi.fn()
    render(
      <ScientificColumnForm
        disabled={false}
        isAdmin
        onAdd={onAdd}
        onError={onError}
      />,
    )
    fireEvent.change(
      screen.getByLabelText(t('notebook.scientificSheetBlock.label')),
      { target: { value: 'Mass' } },
    )
    fireEvent.change(
      screen.getByLabelText(t('notebook.scientificSheetBlock.validationJson')),
      { target: { value: '{"min":"not a number"}' } },
    )
    fireEvent.click(
      screen.getByRole('button', {
        name: t('notebook.scientificSheetBlock.addColumn'),
      }),
    )
    expect(onAdd).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledOnce()
  })

  it('keeps formula focus across canonical refresh and restores canonical text on Escape', () => {
    const onCommit = vi.fn(async (_source: string) => {})
    const onStatusClear = vi.fn()

    const props = {
      selected: true,
      coords: { row: 0, col: 1 },
      status: '',
      onCommit,
      onStatusClear,
    }

    const { rerender } = render(
      <ScientificFormulaBar {...props} display="=A1+1" />,
    )

    const input = screen.getByRole<HTMLInputElement>('textbox', {
      name: t('notebook.scientificSheetBlock.formulaSourceAriaLabel'),
    })

    input.focus()
    fireEvent.change(input, { target: { value: '=2**3' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledWith('=2^3')
    rerender(<ScientificFormulaBar {...props} display="=2^3" />)
    expect(screen.getByRole('textbox')).toBe(input)
    expect(document.activeElement).toBe(input)
    fireEvent.change(input, { target: { value: '=99' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.value).toBe('=2^3')
    expect(onStatusClear).toHaveBeenCalledOnce()
  })

  it('uses an inline alert, not a second dialog, for schema confirmation', () => {
    const column = table.columns.at(0)

    if (!column) throw new Error('Missing fixture column')
    const onCancel = vi.fn()
    render(
      <ScientificSchemaConfirmation
        confirmation={{
          kind: 'convert',
          targetType: 'integer',
          column,
          evidence: {
            tableId: table.id,
            columnId: column.id,
            schemaVersion: 1,
            requiresConfirmation: true,
            hash: 'evidence',
            formulaMarkers: 0,
          },
        }}
        blocked
        disabled={false}
        dependencyCount={2}
        mutate={vi.fn()}
        onCancel={onCancel}
      />,
    )
    expect(
      screen.getByRole('alert', {
        name: t('notebook.scientificSheetBlock.confirmSchemaChangeAriaLabel'),
      }),
    ).toBeTruthy()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: t('notebook.scientificSheetBlock.confirmChange'),
      }).disabled,
    ).toBe(true)
    fireEvent.click(
      screen.getByRole('button', { name: t('common.actions.cancel') }),
    )
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('keeps the dataset link named and hides edits on a read-only table', () => {
    render(
      <ScientificSheetFooter
        table={table}
        rowCount={2}
        readOnly
        saveStatus="idle"
        dataAccess={false}
        calculating={false}
        onRetry={vi.fn()}
        onAdd={vi.fn()}
        onConfigure={vi.fn()}
        onExport={vi.fn()}
        onInspect={vi.fn()}
        onRecalculate={vi.fn()}
      />,
    )

    const link = screen.getByRole('link', {
      name: t('notebook.scientificSheetBlock.exploreDataset'),
    })

    expect(link.getAttribute('href')).toBe(`/datasets/${table.id}`)
    expect(link.hasAttribute('role')).toBe(false)
    expect(
      screen.queryByRole('button', {
        name: t('notebook.scientificSheetBlock.addRowAriaLabel'),
      }),
    ).toBeNull()
    expect(
      screen.queryByRole('button', {
        name: t('notebook.scientificSheetBlock.configureTableAriaLabel'),
      }),
    ).toBeNull()
  })
})
