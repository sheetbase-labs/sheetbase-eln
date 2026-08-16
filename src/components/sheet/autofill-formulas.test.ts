import { describe, it, expect } from 'vitest'
import { HyperFormula, AlwaysSparse } from 'hyperformula'
import { registerAllModules } from 'handsontable/registry'
import Handsontable from 'handsontable'

// jsdom polyfills
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}
globalThis.ResizeObserver = ResizeObserverStub
globalThis.IntersectionObserver = IntersectionObserverStub as any

registerAllModules()

function makeGrid(
  containerId: string,
  engine: HyperFormula,
  sheetName: string,
) {
  document.body.innerHTML = `<div id="${containerId}"></div>`
  const container = document.getElementById(containerId)!
  return new Handsontable(container, {
    data: [
      { a: 3, b: '=A1*2', c: 'X' },
      { a: 4, b: 7, c: 'Y' },
      { a: 5, b: 6.6, c: 'Z' },
      { a: 6, b: 5.9, c: 'W' },
    ],
    columns: [
      { data: 'a', title: 'A' },
      { data: 'b', title: 'B' },
      { data: 'c', title: 'C' },
    ],
    colHeaders: true,
    rowHeaders: true,
    formulas: { engine, sheetName },
    fillHandle: true,
    stretchH: 'none',
    licenseKey: 'non-commercial-and-evaluation',
  })
}

describe('Handsontable formulas plugin + autofill integration', () => {
  it('formulas plugin evaluates formulas and source data stores formula', () => {
    const engine = HyperFormula.buildEmpty({
      licenseKey: 'gpl-v3',
      chooseAddressMappingPolicy: new AlwaysSparse(),
    })
    engine.addSheet('sheet1')
    const hot = makeGrid('grid1', engine, 'sheet1')

    const fp = hot.getPlugin('formulas')
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    expect(fp?.enabled).toBe(true)
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    expect(fp?.engine?.doesSheetExist('sheet1')).toBe(true)

    // B1 = =A1*2 = 3*2 = 6
    expect(hot.getDataAtCell(0, 1)).toBe(6)
    // Source data should be the formula expression
    const srcB1 = hot.getSourceDataAtCell(0, 1)
    // The formulas plugin's modifySourceData should return the formula
    // (or the raw value if the engine stores it differently)
    expect(typeof srcB1).toBe('string')
    expect(srcB1).toContain('A1')

    hot.destroy()
    engine.destroy()
  })

  it('beforeAutofill hook from formulas plugin translates formulas', () => {
    const engine = HyperFormula.buildEmpty({
      licenseKey: 'gpl-v3',
      chooseAddressMappingPolicy: new AlwaysSparse(),
    })
    engine.addSheet('sheet2')
    const hot = makeGrid('grid2', engine, 'sheet2')

    const b1Computed = hot.getDataAtCell(0, 1) // 6
    const sourceRange = hot._createCellRange(
      hot._createCellCoords(0, 1),
      hot._createCellCoords(0, 1),
    )
    const targetRange = hot._createCellRange(
      hot._createCellCoords(1, 1),
      hot._createCellCoords(3, 1),
    )

    const result: unknown = hot.runHooks(
      'beforeAutofill',
      [[b1Computed]],
      sourceRange,
      targetRange,
      'down',
    )

    // The formulas plugin should return translated formulas
    expect(Array.isArray(result)).toBe(true)
    const translated = result as unknown[][]
    expect(translated[0][0]).toBe('=A2*2')
    expect(translated[1][0]).toBe('=A3*2')
    expect(translated[2][0]).toBe('=A4*2')

    hot.destroy()
    engine.destroy()
  })

  it('populateFromArray with translated formulas sets source and display', () => {
    const engine = HyperFormula.buildEmpty({
      licenseKey: 'gpl-v3',
      chooseAddressMappingPolicy: new AlwaysSparse(),
    })
    engine.addSheet('sheet3')
    const hot = makeGrid('grid3', engine, 'sheet3')

    // Get translated formulas from beforeAutofill
    const b1Computed = hot.getDataAtCell(0, 1)
    const sourceRange = hot._createCellRange(
      hot._createCellCoords(0, 1),
      hot._createCellCoords(0, 1),
    )
    const targetRange = hot._createCellRange(
      hot._createCellCoords(1, 1),
      hot._createCellCoords(3, 1),
    )
    const fillData: unknown = hot.runHooks(
      'beforeAutofill',
      [[b1Computed]],
      sourceRange,
      targetRange,
      'down',
    )

    // Populate B2:B4 with translated formulas
    hot.populateFromArray(1, 1, fillData as unknown[][], 3, 1, 'Autofill.fill')

    expect(hot.getSourceDataAtCell(1, 1)).toBe('=A2*2')
    expect(hot.getDataAtCell(1, 1)).toBe(8) // 4*2
    expect(hot.getSourceDataAtCell(2, 1)).toBe('=A3*2')
    expect(hot.getDataAtCell(2, 1)).toBe(10) // 5*2

    hot.destroy()
    engine.destroy()
  })

  it('source data retains formula expression while display shows computed value', () => {
    const engine = HyperFormula.buildEmpty({
      licenseKey: 'gpl-v3',
      chooseAddressMappingPolicy: new AlwaysSparse(),
    })
    engine.addSheet('sheet4')
    const hot = makeGrid('grid4', engine, 'sheet4')

    // Source data stores the formula expression (=A1*2)
    expect(hot.getSourceDataAtCell(0, 1)).toContain('A1')
    // Display data shows the computed value (6 = 3*2)
    expect(hot.getDataAtCell(0, 1)).toBe(6)
    // Source data array also contains the formula expression
    const srcArr = hot.getSourceDataArray(0, 1, 0, 1)
    expect(JSON.stringify(srcArr)).toContain('A1')

    hot.destroy()
    engine.destroy()
  })
})
