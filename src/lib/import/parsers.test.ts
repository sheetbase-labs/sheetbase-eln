import { describe, expect, it } from 'vitest'

import {
  IMPORT_PARSERS,
  previewHeaderSample,
  recogniseImportParser,
} from './parsers'

describe('recogniseImportParser', () => {
  it('recognises the approved xlsx plate map from its required headers', () => {
    const match = recogniseImportParser({
      format: 'xlsx',
      headers: ['Sample', 'Well', 'Dilution'],
    })
    expect(match?.key).toBe('sheetbase.plate-map')
    expect(match?.format).toBe('xlsx')
    expect(match?.version).toBe(1)
    expect(match?.matchedHeaders).toContain('sample')
    expect(match?.matchedHeaders).toContain('well')
    // 2 required + 1 optional matched of 2 required + 6 optional, rounded to 2dp
    expect(match?.confidence).toBe(0.38)
  })

  it('matches header tokens that carry a unit suffix', () => {
    const match = recogniseImportParser({
      format: 'xlsx',
      headers: ['Sample', 'Well', 'OD450 (AU)'],
    })
    expect(match?.matchedHeaders).toContain('od450')
  })

  it('requires the metadata block for the text plate-reader format', () => {
    const withoutMetadata = recogniseImportParser({
      format: 'csv',
      headers: ['Sample', 'Well', 'OD450'],
    })
    expect(withoutMetadata).toBeNull()

    const withMetadata = recogniseImportParser({
      format: 'csv',
      headers: ['Sample', 'Well', 'OD450'],
      rawTextHint: '# Instrument: PR-01\nSample,Well,OD450\n',
    })
    expect(withMetadata?.key).toBe('sheetbase.plate-reader-csv')
  })

  it('never auto-recognises a draft parser', () => {
    const match = recogniseImportParser({
      format: 'csv',
      headers: ['Sample', 'NTU', 'Dil', 'Timestamp'],
    })
    expect(match).toBeNull()
    // it is still offered as an experiment on the failure page
    expect(IMPORT_PARSERS.some((parser) => parser.status === 'draft')).toBe(
      true,
    )
  })

  it('returns null when the format or headers do not match', () => {
    expect(
      recogniseImportParser({ format: 'json', headers: ['Sample', 'Well'] }),
    ).toBeNull()
    expect(
      recogniseImportParser({ format: 'xlsx', headers: ['Alpha', 'Beta'] }),
    ).toBeNull()
  })

  it('prefers the higher-confidence match', () => {
    const match = recogniseImportParser({
      format: 'csv',
      headers: ['Sample', 'Well', 'OD', 'Conc', 'Dilution', 'Raw'],
      rawTextHint: '# Instrument: PR-01\n',
    })
    expect(match?.key).toBe('sheetbase.plate-reader-csv')
    // 2 required + 4 of 5 optional, rounded to 2dp
    expect(match?.confidence).toBe(0.86)
  })
})

describe('previewHeaderSample', () => {
  it('reports the first sheet headers, the total row count and all sheet names', () => {
    const sample = previewHeaderSample({
      format: 'csv',
      detectedTypes: [],
      sheets: [
        { name: 'Reads', headers: ['Sample', 'Well'], rows: [{}, {}] },
        { name: 'Controls', headers: ['Sample', 'Well'], rows: [{}] },
      ],
    })
    expect(sample.headers).toEqual(['Sample', 'Well'])
    expect(sample.rowCount).toBe(3)
    expect(sample.sheetNames).toEqual(['Reads', 'Controls'])
  })
})
