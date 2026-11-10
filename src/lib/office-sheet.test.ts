import { readFileSync } from 'node:fs'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import {
  buildSheetState,
  canMakeSheet,
  columnLetters,
  OfficeSheetError,
  readOfficeSheets,
  shiftFormula,
  XLSX_MEDIA_TYPE,
} from './office-sheet'
import { sheetInstanceStateSchema } from './sheet-instance'
import { validateCanonicalCell } from './canonical-sheet-grid'

const fixture = (name: string) =>
  new Uint8Array(readFileSync(`tests/fixtures/office/${name}`))

function sequentialIds() {
  let n = 0

  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
}

function workbook(sheetXml: string, extra: Record<string, string> = {}) {
  return zipSync({
    'xl/workbook.xml': strToU8(
      '<workbook><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      `<worksheet><sheetData>${sheetXml}</sheetData></worksheet>`,
    ),
    ...Object.fromEntries(
      Object.entries(extra).map(([name, xml]) => [name, strToU8(xml)]),
    ),
  })
}

describe('formula helpers', () => {
  it('names columns the way Excel does', () => {
    expect([0, 25, 26, 51, 702].map(columnLetters)).toEqual([
      'A',
      'Z',
      'AA',
      'AZ',
      'AAA',
    ])
  })

  it('shifts only the relative parts of a reference', () => {
    expect(shiftFormula('B2*$C$2+D$2', 3, 1)).toBe('C5*$C$2+E$2')
    expect(shiftFormula('IF(A2>0,"B2 stays",B2)', 1, 0)).toBe(
      'IF(A3>0,"B2 stays",B3)',
    )
  })
})

describe('reading a workbook', () => {
  it('reads values, formulas, dates and booleans from an xlsx', () => {
    const sheets = readOfficeSheets(fixture('titration.xlsx'), XLSX_MEDIA_TYPE)
    expect(sheets.map((s) => s.name)).toEqual(['Titration', 'Notes'])
    const rows = sheets[0].rows
    expect(rows[0]?.[1]?.value).toBe('Absorbance (AU)')
    expect(rows[1]?.[3]).toEqual({ value: 4.3, formula: 'B2*C2' })
    expect(rows[1]?.[4]?.value).toEqual(expect.any(String))
    expect(rows[1]?.[4]?.value).toMatch(/^2026-10-\d\d$/)
    expect(rows[1]?.[5]?.value).toBe(true)
    expect(sheets[1].rows[1]?.[1]?.value).toBe('Dana')
  })

  it('expands shared formulas down the column', () => {
    const bytes = workbook(
      '<row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c><c r="B1" t="inlineStr"><is><t>y</t></is></c></row>' +
        '<row r="2"><c r="A2"><v>2</v></c><c r="B2"><f t="shared" ref="B2:B4" si="0">A2*3</f><v>6</v></c></row>' +
        '<row r="3"><c r="A3"><v>3</v></c><c r="B3"><f t="shared" si="0"/><v>9</v></c></row>' +
        '<row r="4"><c r="A4"><v>4</v></c><c r="B4"><f t="shared" si="0"/><v>12</v></c></row>',
    )

    const [sheet] = readOfficeSheets(bytes, XLSX_MEDIA_TYPE)
    expect(sheet.rows[2]?.[1]).toEqual({ value: 9, formula: 'A3*3' })
    expect(sheet.rows[3]?.[1]).toEqual({ value: 12, formula: 'A4*3' })
  })

  it('skips hidden worksheets and refuses a file that is not a workbook', () => {
    const bytes = zipSync({
      'xl/workbook.xml': strToU8(
        '<workbook><sheets><sheet name="Hidden" state="hidden" r:id="rId1"/></sheets></workbook>',
      ),
    })

    expect(readOfficeSheets(bytes, XLSX_MEDIA_TYPE)).toEqual([])
    expect(() =>
      readOfficeSheets(strToU8('not a zip'), XLSX_MEDIA_TYPE),
    ).toThrow(OfficeSheetError)
  })

  it('knows which files can be made into sheets', () => {
    expect(canMakeSheet(XLSX_MEDIA_TYPE)).toBe(true)
    expect(canMakeSheet('application/vnd.oasis.opendocument.spreadsheet')).toBe(
      true,
    )
    expect(canMakeSheet('application/pdf')).toBe(false)
  })
})

describe('making a sheet', () => {
  const [titration] = readOfficeSheets(
    fixture('titration.xlsx'),
    XLSX_MEDIA_TYPE,
  )

  const made = buildSheetState(titration, { newId: sequentialIds() })

  it('produces state the sheet accepts', () => {
    expect(sheetInstanceStateSchema.safeParse(made.state).success).toBe(true)
    expect(made.rowCount).toBe(30)
    expect(made.columnCount).toBe(7)
  })

  it('types the columns from their values', () => {
    const types = Object.fromEntries(
      made.state.localFields.map((f) => [f.label, f.logicalType]),
    )

    expect(types).toMatchObject({
      Sample: 'text',
      'Absorbance (AU)': 'decimal',
      Dilution: 'integer',
      Date: 'date',
      Passed: 'boolean',
    })
  })

  it('keeps what Excel calculated and names the formula columns', () => {
    expect(made.formulaColumns).toEqual([
      { label: 'Result', example: '=B2*C2' },
      { label: 'Total check', example: '=SUM($B$2:$B$31)' },
    ])

    const fieldIdFor = (label: string) => {
      const field = made.state.localFields.find((f) => f.label === label)

      if (!field) throw new Error(`the made sheet has no ${label} column`)

      return field.fieldId
    }

    const rows = Object.values(made.state.localValues)
    expect(rows[0][fieldIdFor('Result')]).toBe(4.3)
    expect(made.state.instanceCalculations).toBeUndefined()
    expect(rows[0][fieldIdFor('Total check')]).toBe(17.25)
  })

  it('keeps the first row as headers and the original column order', () => {
    expect(made.state.presentation.columnOrder).toHaveLength(7)

    const byId = new Map(
      made.state.localFields.map((f) => [f.fieldId, f.label] as const),
    )

    expect(
      made.state.presentation.columnOrder.map((id) => byId.get(id)),
    ).toEqual([
      'Sample',
      'Absorbance (AU)',
      'Dilution',
      'Result',
      'Date',
      'Passed',
      'Total check',
    ])
  })

  it('stores values every field accepts', () => {
    for (const row of Object.values(made.state.localValues)) {
      for (const [fieldId, value] of Object.entries(row)) {
        const field = made.state.localFields.find((f) => f.fieldId === fieldId)
        expect(validateCanonicalCell(field ?? null, value)).toBeNull()
      }
    }
  })

  it('turns a text-only worksheet into text columns', () => {
    const [, notes] = readOfficeSheets(
      fixture('titration.xlsx'),
      XLSX_MEDIA_TYPE,
    )

    const result = buildSheetState(notes, { newId: sequentialIds() })
    expect(result.state.localFields.map((f) => f.logicalType)).toEqual([
      'text',
      'text',
    ])
    expect(result.rowCount).toBe(2)
    expect(result.formulaColumns).toEqual([])
  })

  it('names blank and repeated headers', () => {
    const result = buildSheetState(
      {
        name: 'x',
        rows: [
          [{ value: 'Name' }, { value: 'Name' }, undefined, { value: 'Z' }],
          [{ value: 'a' }, { value: 'b' }, { value: 1 }, { value: 2 }],
        ],
      },
      { newId: sequentialIds() },
    )

    expect(result.state.localFields.map((f) => f.label)).toEqual([
      'Name',
      'Name',
      'Column C',
      'Z',
    ])
    expect(new Set(result.state.localFields.map((f) => f.key)).size).toBe(4)
  })

  it('says so when a worksheet has nothing in it', () => {
    expect(() => buildSheetState({ name: 'x', rows: [] })).toThrow(
      OfficeSheetError,
    )
  })
})
