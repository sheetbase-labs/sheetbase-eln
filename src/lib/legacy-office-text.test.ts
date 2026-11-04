import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  extractDocText,
  extractXlsText,
  isCompoundFile,
  readCompoundFile,
} from './legacy-office-text'
import { extractDocumentText, isSearchableMediaType } from './file-text'

const fixture = (name: string) =>
  new Uint8Array(readFileSync(`tests/fixtures/office/${name}`))

function stream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

describe('legacy .xls', () => {
  const text = extractXlsText(fixture('sample.xls'))

  it('lists the sheet names first', () => {
    expect(text.split('\n').slice(0, 2)).toEqual(['Titration', 'Big strings'])
  })

  it('reads text cells, numbers and formula results by row', () => {
    expect(text).toContain('Sample Absorbance Dilution Result')
    expect(text).toContain('S-007 aardvarkine 0.49 10 4.9')
    expect(text).toContain('Concentration µg/mL °C')
  })

  it('reads a formula that returns text', () => {
    expect(text).toContain('high')
  })

  it('reads shared strings that run over CONTINUE records', () => {
    expect(text).toContain(
      'unique string number 399 with padding text 399 wombatine',
    )
    expect(text).toContain('unique string number 150 with padding text 150')
  })

  it('returns nothing for bytes that are not a compound file', () => {
    expect(extractXlsText(new Uint8Array(2048))).toBe('')
    expect(isCompoundFile(new Uint8Array(10))).toBe(false)
    expect(() => readCompoundFile(new Uint8Array(10))).toThrow()
  })

  it('survives a truncated file without throwing past the reader', () => {
    const bytes = fixture('sample.xls')
    expect(() => extractXlsText(bytes.subarray(0, 4096))).not.toThrow(
      /Maximum call stack/,
    )
  })
})

describe('legacy .doc', () => {
  it('reads the body, including table cells', async () => {
    const text = await extractDocText(fixture('sample.doc'))
    expect(text).toContain('Buffer preparation')
    expect(text).toContain('okapine salt in 800 mL water')
    expect(text).toContain('Tris')
    expect(text).toContain('12.1 g')
  })
})

describe('through the upload path', () => {
  it('treats .doc and .xls as searchable', () => {
    expect(isSearchableMediaType('application/msword')).toBe(true)
    expect(isSearchableMediaType('application/vnd.ms-excel')).toBe(true)
  })

  it('extracts both from a byte stream', async () => {
    expect(
      await extractDocumentText(
        stream(fixture('sample.xls')),
        'application/vnd.ms-excel',
      ),
    ).toContain('wombatine')
    expect(
      await extractDocumentText(
        stream(fixture('sample.doc')),
        'application/msword',
      ),
    ).toContain('okapine')
  })
})
