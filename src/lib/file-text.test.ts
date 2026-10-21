import { zipSync, strToU8 } from 'fflate'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'

import {
  extractDocumentText,
  extractOfficeText,
  extractTextFromStream,
  isDocumentExtractableMediaType,
  isSearchableMediaType,
  isTextExtractableMediaType,
  TEXT_EXTRACT_MAX_BYTES,
} from '#/lib/file-text'

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

describe('isTextExtractableMediaType', () => {
  it('accepts CSV, plain text and JSON, case-insensitively', () => {
    expect(isTextExtractableMediaType('text/csv')).toBe(true)
    expect(isTextExtractableMediaType('TEXT/PLAIN')).toBe(true)
    expect(isTextExtractableMediaType('application/json')).toBe(true)
  })

  it('rejects binary formats', () => {
    expect(isTextExtractableMediaType('application/pdf')).toBe(false)
    expect(isTextExtractableMediaType('image/png')).toBe(false)
  })
})

describe('extractTextFromStream', () => {
  it('decodes UTF-8 text and keeps newlines', async () => {
    const bytes = new TextEncoder().encode('a,b\n1,2\n3,4\n')
    await expect(extractTextFromStream(streamOf(bytes))).resolves.toBe(
      'a,b\n1,2\n3,4\n',
    )
  })

  it('stops at the byte cap', async () => {
    const bytes = new TextEncoder().encode('x'.repeat(100))
    const text = await extractTextFromStream(streamOf(bytes), 10)
    expect(text).toHaveLength(10)
  })

  it('replaces invalid sequences instead of throwing', async () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x61])
    const text = await extractTextFromStream(streamOf(bytes))
    expect(text).toContain('a')
  })

  it('defaults the cap to two megabytes', () => {
    expect(TEXT_EXTRACT_MAX_BYTES).toBe(2 * 1024 * 1024)
  })
})

const DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const PPTX =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'

describe('document media types', () => {
  it('recognises PDF and Office formats as searchable', () => {
    for (const type of ['application/pdf', DOCX, XLSX, PPTX]) {
      expect(isDocumentExtractableMediaType(type)).toBe(true)
      expect(isSearchableMediaType(type)).toBe(true)
    }
    expect(isSearchableMediaType('text/csv')).toBe(true)
    expect(isSearchableMediaType('image/png')).toBe(false)
    expect(isSearchableMediaType('application/octet-stream')).toBe(false)
  })
})

describe('extractOfficeText', () => {
  it('reads paragraphs, tabs and entities from a docx', () => {
    const bytes = zipSync({
      'word/document.xml': strToU8(
        '<w:document><w:body>' +
          '<w:p><w:r><w:t>Buffer prep</w:t></w:r></w:p>' +
          '<w:p><w:r><w:t xml:space="preserve">Tris &amp; NaCl</w:t></w:r><w:tab/><w:r><w:t>pH 7.4</w:t></w:r></w:p>' +
          '</w:body></w:document>',
      ),
      'word/styles.xml': strToU8('<w:t>ignored</w:t>'),
    })
    expect(extractOfficeText(bytes, DOCX)).toBe(
      'Buffer prep\nTris & NaCl pH 7.4',
    )
  })

  it('reads shared strings and inline strings from an xlsx', () => {
    const bytes = zipSync({
      'xl/sharedStrings.xml': strToU8(
        '<sst><si><t>Capsid titre</t></si><si><r><t>Plate</t></r><r><t> 4</t></r></si></sst>',
      ),
      'xl/worksheets/sheet1.xml': strToU8(
        '<worksheet><sheetData><row><c t="s"><v>0</v></c><c t="inlineStr"><is><t>inline note</t></is></c></row></sheetData></worksheet>',
      ),
    })
    const text = extractOfficeText(bytes, XLSX)
    expect(text).toContain('Capsid titre')
    expect(text).toContain('Plate 4')
    expect(text).toContain('inline note')
    expect(text).not.toContain('<')
  })

  it('reads slides in numeric order plus speaker notes from a pptx', () => {
    const slide = (text: string) =>
      strToU8(`<p:sld><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:sld>`)
    const bytes = zipSync({
      'ppt/slides/slide10.xml': slide('tenth'),
      'ppt/slides/slide2.xml': slide('second'),
      'ppt/notesSlides/notesSlide2.xml': slide('note two'),
    })
    expect(extractOfficeText(bytes, PPTX).split('\n')).toEqual([
      'second',
      'note two',
      'tenth',
    ])
  })

  it('rejects an archive that expands past the cap', () => {
    const big = new Uint8Array(70 * 1024 * 1024)
    const bytes = zipSync({ 'word/document.xml': big })
    expect(() => extractOfficeText(bytes, DOCX)).toThrow(/cap/)
  })

  it('throws on bytes that are not a zip archive', () => {
    expect(() => extractOfficeText(strToU8('not a zip'), DOCX)).toThrow()
  })
})

describe('extractDocumentText', () => {
  it('extracts the text layer of a PDF', async () => {
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const page = pdf.addPage()
    page.drawText('Western blot protocol', { x: 50, y: 700, font, size: 12 })
    page.drawText('Incubate overnight at 4C', { x: 50, y: 680, font, size: 12 })
    const text = await extractDocumentText(
      streamOf(await pdf.save()),
      'application/pdf',
    )
    expect(text).toContain('Western blot protocol')
    expect(text).toContain('Incubate overnight at 4C')
  })

  it('returns nothing for a PDF with no text layer', async () => {
    const pdf = await PDFDocument.create()
    pdf.addPage()
    const text = await extractDocumentText(
      streamOf(await pdf.save()),
      'application/pdf',
    )
    expect(text.trim()).toBe('')
  })

  it('throws on a corrupt PDF so the caller can log it', async () => {
    await expect(
      extractDocumentText(streamOf(strToU8('%PDF-garbage')), 'application/pdf'),
    ).rejects.toThrow()
  })

  it('dispatches text formats and ignores unsupported ones', async () => {
    await expect(
      extractDocumentText(streamOf(strToU8('a,b\n1,2')), 'text/csv'),
    ).resolves.toBe('a,b\n1,2')
    await expect(
      extractDocumentText(streamOf(strToU8('x')), 'image/png'),
    ).resolves.toBe('')
  })

  it('extracts an Office file from a stream', async () => {
    const bytes = zipSync({
      'word/document.xml': strToU8(
        '<w:p><w:r><w:t>hello docx</w:t></w:r></w:p>',
      ),
    })
    await expect(extractDocumentText(streamOf(bytes), DOCX)).resolves.toBe(
      'hello docx',
    )
  })
})
