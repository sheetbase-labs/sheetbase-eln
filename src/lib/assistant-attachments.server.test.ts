import { describe, expect, it } from 'vitest'

import {
  AttachmentError,
  boundRows,
  readAttachmentFile,
  sniffImageType,
} from './assistant-attachments.server'
import { ATTACHMENT_SHEET_MAX_ROWS } from './assistant-attachments'

const enc = (text: string) => new TextEncoder().encode(text)

describe('readAttachmentFile', () => {
  it('reads a CSV as a table', async () => {
    const file = await readAttachmentFile(
      enc('well,value\nA1,0.12\nA2,0.34\nA3,0.56\n'),
      'plate.csv',
      'text/csv',
    )

    expect(file.kind).toBe('table')
    expect(file.sheets[0].rows[0]).toEqual(['well', 'value'])
    expect(file.sheets[0].rows).toHaveLength(4)
  })

  it('reads a tab-separated reader export with a header block before the plate', async () => {
    const text = [
      'Plate Reader Export',
      'Date\t2026-11-14',
      '',
      '\t1\t2\t3',
      'A\t0.1\t0.2\t0.3',
      'B\t0.4\t0.5\t0.6',
    ].join('\n')

    const file = await readAttachmentFile(enc(text), 'run.txt', 'text/plain')

    expect(file.kind).toBe('table')
    expect(file.sheets[0].rows.some((r) => r[0] === 'B')).toBe(true)
  })

  it('keeps prose as a document', async () => {
    const file = await readAttachmentFile(
      enc(
        'Certificate of analysis\nLot 42 passes all tests.\nExpires 2027-03-01.',
      ),
      'notes.txt',
      'text/plain',
    )

    expect(file.kind).toBe('document')
    expect(file.text).toContain('Lot 42')
  })

  it('keeps JSON as text', async () => {
    const file = await readAttachmentFile(
      enc('{"a":1}'),
      'x.json',
      'application/json',
    )

    expect(file.kind).toBe('document')
  })

  it('takes a picture by its bytes, not its name', async () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
    ])

    const file = await readAttachmentFile(
      png,
      'gel.dat',
      'application/octet-stream',
    )

    expect(file.kind).toBe('image')
    expect(file.image).toMatch(/^data:image\/png;base64,/)
    expect(sniffImageType(png)).toBe('image/png')
  })

  it('refuses a picture type it cannot send', async () => {
    await expect(
      readAttachmentFile(enc('II*\u0000not really'), 'gel.tif', 'image/tiff'),
    ).rejects.toBeInstanceOf(AttachmentError)
  })

  it('refuses an empty file, an unknown type and a binary pretending to be text', async () => {
    await expect(
      readAttachmentFile(new Uint8Array(), 'a.csv', 'text/csv'),
    ).rejects.toMatchObject({ code: 'unreadable' })
    await expect(
      readAttachmentFile(enc('x'), 'a.exe', 'application/octet-stream'),
    ).rejects.toMatchObject({ code: 'unsupported' })
    await expect(
      readAttachmentFile(new Uint8Array([0, 1, 2, 3]), 'a.csv', 'text/csv'),
    ).rejects.toMatchObject({ code: 'unsupported' })
  })

  it('says a damaged workbook is damaged', async () => {
    await expect(
      readAttachmentFile(
        enc('not a zip'),
        'a.xlsx',
        'application/octet-stream',
      ),
    ).rejects.toMatchObject({ code: 'unreadable' })
  })
})

describe('boundRows', () => {
  it('cuts long sheets and long cells, and drops trailing blank rows', () => {
    const rows = Array.from(
      { length: ATTACHMENT_SHEET_MAX_ROWS + 5 },
      (_, i) => [`r${i}`, 'x'.repeat(300)],
    )

    const bounded = boundRows([...rows, ['', ''], ['', '']])

    expect(bounded.truncated).toBe(true)
    expect(bounded.rows).toHaveLength(ATTACHMENT_SHEET_MAX_ROWS)
    expect(bounded.rows[0][1]).toHaveLength(200)

    expect(boundRows([['a'], [''], ['']]).rows).toEqual([['a']])
  })
})
