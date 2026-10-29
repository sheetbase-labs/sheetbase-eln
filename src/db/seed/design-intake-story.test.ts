import { describe, expect, it } from 'vitest'

import { readWithColumns } from '#/lib/connectors/parser-resolution'
import type { ResolvedParser } from '#/lib/connectors/parser-resolution'
import { DEMO_FILES, demoFileKey } from './design-intake-story'

function parser(signature: Record<string, unknown>): ResolvedParser {
  return {
    parserId: 'p',
    parserVersionId: 'v',
    key: 'tb_02',
    name: 'TB-02 CSV',
    format: 'csv',
    version: 1,
    status: 'approved',
    signature,
    kind: 'columns',
  }
}

const COLUMNS = ['sample', 'turbidity', 'dilution']
const LAYOUT = {
  delimiter: 'semicolon',
  headerStartsWith: 'Sample',
  readDetails: true,
  units: 'header',
  decimalComma: true,
}

describe('the TB-02 firmware story in the demo data', () => {
  it('has two files the old parser refuses and the firmware 4 parser reads', () => {
    expect(DEMO_FILES).toHaveLength(2)
    for (const file of DEMO_FILES) {
      expect(() =>
        readWithColumns(parser({ requiredHeaders: COLUMNS }), file.text),
      ).toThrow(/needs \(sample, turbidity, dilution\)/)
      const read = readWithColumns(
        parser({ requiredHeaders: COLUMNS, layout: LAYOUT }),
        file.text,
      )
      expect(read.headers).toEqual([
        'Sample',
        'Turbidity',
        'Dilution',
        'Timestamp',
      ])
      expect(read.metadata).toMatchObject({
        Serial: 'TB02-0117',
        'Turbidity unit': 'NTU',
      })
    }
  })

  it('reads decimal commas as numbers and a footer can be left out', () => {
    const [first] = DEMO_FILES
    const read = readWithColumns(
      parser({ requiredHeaders: COLUMNS, layout: LAYOUT }),
      first.text,
    )
    expect(read.rows[0]).toMatchObject({
      Sample: 'SMP-2250',
      Turbidity: '12.4',
    })
    const withFooter = readWithColumns(
      parser({
        requiredHeaders: COLUMNS,
        layout: { ...LAYOUT, stopAt: 'Summary' },
      }),
      `${first.text}Summary;;;\nMean;12.8;;\n`,
    )
    expect(withFooter.rows).toHaveLength(3)
  })

  it('keeps each file under a stable name in the object store', () => {
    const keys = DEMO_FILES.map(demoFileKey)
    expect(new Set(keys).size).toBe(2)
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f]{32}$/)
  })
})
