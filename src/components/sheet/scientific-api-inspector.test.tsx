import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { t } from '#/copy'
import type {
  ScientificColumnWire,
  ScientificTableWire,
} from '#/lib/scientific-sheet-data'
import { buildScientificApiExamples } from './scientific-api-examples'
import { ScientificApiInspector } from './scientific-api-inspector'

function column(
  overrides: Partial<ScientificColumnWire> = {},
): ScientificColumnWire {
  return {
    id: 'field-1',
    field_name: 'col_amount',
    label: 'Amount',
    display_order: 0,
    logical_type: 'decimal',
    nullable: false,
    unit: { symbol: 'mg', code: 'milligram' },
    validation: {
      min: 0,
      annotation: { source: 'instrument', bounds: [0, 10] },
      absent: null,
      series: [1, null, ['two', null], { source: 'instrument' }],
    },
    width: null,
    options: [],
    ...overrides,
  }
}

function table(columns = [column()]): ScientificTableWire {
  return {
    id: 'table-1',
    name: 'Measured amounts',
    resource_name: 'sheet_amounts',
    schema_version: 3,
    lifecycle: 'active',
    columns,
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('scientific API examples', () => {
  it('keeps shell continuations, quoting, scalar bodies and version guards intact', () => {
    const examples = buildScientificApiExamples(
      table([
        column(),
        column({
          id: 'field-2',
          field_name: 'col_enabled',
          logical_type: 'boolean',
        }),
      ]),
      { rowId: "row'quoted", rowVersion: 7 },
    )

    expect(examples.map((example) => example.id)).toEqual([
      'list',
      'filter',
      'insert',
      'update',
    ])
    expect(examples[0].code).toBe(
      [
        'curl --fail -G',
        '-H "Authorization: Bearer $TOKEN"',
        "'/api/db/sheet_amounts?select=id,version,col_amount,col_enabled&order=created_at.asc,id.asc&limit=50'",
      ].join(' \\\n  '),
    )
    expect(examples[2].body).toEqual({ col_amount: 1.5, col_enabled: true })
    expect(examples[2].code).toContain(
      `-d '{"col_amount":1.5,"col_enabled":true}'`,
    )
    expect(examples[3].path).toBe(
      "/api/db/sheet_amounts?id=eq.row'quoted&version=eq.7",
    )
    expect(examples[3].code).toContain("row'\\''quoted")
    expect(examples[3].body).toEqual({ col_enabled: true })
  })

  it('retains defaults for empty tables and category values', () => {
    const examples = buildScientificApiExamples(table([]))
    expect(examples[0].path).toContain('select=id,version&')
    expect(examples[1].path).toContain('col_<field>=not.is.null')
    expect(examples[2].body).toEqual({})
    expect(examples[3].path).toContain('id=eq.<row-uuid>&version=eq.1')
    expect(examples[3].body).toEqual({ 'col_<field>': 'value' })

    const category = buildScientificApiExamples(
      table([
        column({
          logical_type: 'category',
          options: [{ id: 'option-1', label: 'High', display_order: 0 }],
        }),
      ]),
    )

    expect(category[2].body).toEqual({ col_amount: 'option-1' })
  })
})

describe('ScientificApiInspector', () => {
  it('preserves the details structure and legacy validation coercion', async () => {
    const user = userEvent.setup()

    const { container } = render(
      <ScientificApiInspector
        table={table()}
        selectedColumnId="field-1"
        selectedRowId="row-1"
        selectedRowVersion={7}
      />,
    )

    const details = container.querySelector('details')
    expect(details?.className).toBe(
      'mt-3 rounded-md border bg-muted/20 text-xs',
    )
    expect(details?.open).toBe(false)
    await user.click(
      screen.getByText(t('notebook.scientificApiInspector.apiInspector')),
    )
    expect(details?.open).toBe(true)
    const body = details?.children[1]
    expect(body?.className).toBe('space-y-5 border-t px-3 py-4')
    expect(
      Array.from(body?.children ?? []).map((element) => element.tagName),
    ).toEqual(['SECTION', 'SECTION', 'SECTION', 'SECTION', 'SECTION'])

    const identity = screen.getByRole('region', {
      name: t('notebook.scientificApiInspector.sheetIdentity'),
    })

    expect(within(identity).getByText('Measured amounts')).toBeTruthy()
    expect(within(identity).getByText('row-1 · version 7')).toBeTruthy()

    const fields = screen.getByRole('region', {
      name: t('notebook.scientificApiInspector.fields'),
    })

    expect(within(fields).getByText('mg (milligram)')).toBeTruthy()
    expect(fields.textContent).toContain('min: 0')
    expect(fields.textContent).toContain('annotation: [object Object]')
    expect(fields.textContent).toContain('absent: null')
    expect(fields.textContent).toContain('series: 1,,two,,[object Object]')
    expect(fields.textContent).not.toContain('{"source":')
  })

  it('copies the displayed request and changes only its copy button', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    render(<ScientificApiInspector table={table()} />)
    await user.click(
      screen.getByText(t('notebook.scientificApiInspector.apiInspector')),
    )

    const examples = screen.getByRole('region', {
      name: t('notebook.scientificApiInspector.authenticatedRequestExamples'),
    })

    const buttons = within(examples).getAllByRole('button', {
      name: t('common.actions.copy'),
    })

    await user.click(buttons[2])
    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      buildScientificApiExamples(table())[2].code,
    )
    expect(
      within(examples).getAllByRole('button', {
        name: t('common.states.copied'),
      }),
    ).toHaveLength(1)
    expect(
      within(examples).getAllByRole('button', {
        name: t('common.actions.copy'),
      }),
    ).toHaveLength(3)
  })

  it('ignores non-string unit extensions and retains category/default display rules', async () => {
    const user = userEvent.setup()
    render(
      <ScientificApiInspector
        table={table([
          column({ unit: { symbol: 'mg', code: { legacy: 'milligram' } } }),
          column({
            id: 'field-2',
            label: 'Category',
            field_name: 'col_category',
            logical_type: 'category',
            unit: null,
            validation: {},
            options: [{ id: 'option-1', label: 'High', display_order: 0 }],
          }),
        ])}
      />,
    )
    await user.click(
      screen.getByText(t('notebook.scientificApiInspector.apiInspector')),
    )

    const fields = screen.getByRole('region', {
      name: t('notebook.scientificApiInspector.fields'),
    })

    expect(within(fields).getByText('mg')).toBeTruthy()
    expect(within(fields).getByText(t('common.states.none'))).toBeTruthy()
    expect(fields.textContent).toContain('1 allowed option')
  })
})
