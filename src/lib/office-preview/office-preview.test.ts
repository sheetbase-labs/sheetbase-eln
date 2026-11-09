import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { previewKindOf } from './kinds'
import { readCsvSheets, readOdsSheets, readXlsxSheets } from './sheets'
import { readOdpSlides, readPptxSlides } from './slides'
import { readOdtHtml, sanitiseDocumentHtml } from './document'

const limits = { rows: 50, columns: 10 }

describe('previewKindOf', () => {
  it('reads the media type, then the extension', () => {
    expect(previewKindOf('application/pdf', 'x')).toBe('pdf')
    expect(previewKindOf('application/octet-stream', 'Plan.DOCX')).toBe(
      'document',
    )
    expect(previewKindOf('application/octet-stream', 'run.ods')).toBe('sheet')
    expect(previewKindOf('text/plain', 'notes.txt')).toBeNull()
  })
})

describe('sheets', () => {
  it('reads a csv and cuts it to the limits', () => {
    const csv = [
      'a,b,c',
      ...Array.from({ length: 100 }, (_, i) => `${i},2,3`),
    ].join('\n')

    const sheet = readCsvSheets(strToU8(csv), { rows: 10, columns: 2 })[0]
    expect(sheet.rows).toHaveLength(10)
    expect(sheet.rows[0]).toEqual(['a', 'b'])
    expect(sheet.totalRows).toBe(101)
    expect(sheet.totalColumns).toBe(3)
  })

  it('reads every worksheet of an xlsx', async () => {
    const files = {
      'xl/workbook.xml': strToU8(
        '<workbook xmlns:r="r"><sheets><sheet name="Plate 1" sheetId="1" r:id="rId1"/><sheet name="Plate 2" sheetId="2" r:id="rId2"/></sheets></workbook>',
      ),
      'xl/_rels/workbook.xml.rels': strToU8(
        '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
      ),
      'xl/sharedStrings.xml': strToU8(
        '<sst><si><t>Well</t></si><si><t>OD</t></si></sst>',
      ),
      'xl/worksheets/sheet1.xml': strToU8(
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2"><v>1</v></c><c r="B2"><v>0.52</v></c></row></sheetData></worksheet>',
      ),
      'xl/worksheets/sheet2.xml': strToU8(
        '<worksheet><sheetData><row r="1"><c r="A1"><v>9</v></c></row></sheetData></worksheet>',
      ),
    }

    const sheets = await readXlsxSheets(zipSync(files, { level: 0 }), limits)
    expect(sheets.map((s) => s.name)).toEqual(['Plate 1', 'Plate 2'])
    expect(sheets[0].rows).toEqual([
      ['Well', 'OD'],
      ['1', '0.52'],
    ])
  })

  it('reads an ods, expanding repeated cells but not trailing blanks', () => {
    const content = `<?xml version="1.0"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
<office:body><office:spreadsheet>
<table:table table:name="Counts">
<table:table-row><table:table-cell><text:p>Strain</text:p></table:table-cell><table:table-cell><text:p>CFU</text:p></table:table-cell></table:table-row>
<table:table-row><table:table-cell><text:p>K-12</text:p></table:table-cell><table:table-cell table:number-columns-repeated="2"><text:p>40</text:p></table:table-cell></table:table-row>
<table:table-row table:number-rows-repeated="1048000"><table:table-cell table:number-columns-repeated="1024"/></table:table-row>
</table:table></office:spreadsheet></office:body></office:document-content>`

    const sheet = readOdsSheets(
      zipSync({ 'content.xml': strToU8(content) }),
      limits,
    )[0]

    expect(sheet.name).toBe('Counts')
    expect(sheet.rows).toEqual([
      ['Strain', 'CFU'],
      ['K-12', '40', '40'],
    ])
  })
})

describe('slides', () => {
  it('reads pptx slides in presentation order with title and text', () => {
    const slide = (title: string, body: string) =>
      `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree>
<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:txBody><a:p><a:r><a:t>${body}</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:sld>`

    const files = {
      'ppt/presentation.xml': strToU8(
        '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/></p:sldIdLst></p:presentation>',
      ),
      'ppt/_rels/presentation.xml.rels': strToU8(
        '<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/><Relationship Id="rId2" Target="slides/slide2.xml"/></Relationships>',
      ),
      'ppt/slides/slide1.xml': strToU8(slide('First', 'one')),
      'ppt/slides/slide2.xml': strToU8(slide('Second', 'two')),
    }

    const slides = readPptxSlides(zipSync(files))
    expect(slides.map((s) => s.title)).toEqual(['Second', 'First'])
    expect(slides[0].lines).toEqual(['two'])
  })

  it('reads odp pages', () => {
    const content = `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0"><office:body><office:presentation>
<draw:page><draw:frame presentation:class="title"><draw:text-box><text:p>Results</text:p></draw:text-box></draw:frame><draw:frame><draw:text-box><text:p>Yield up 12%</text:p></draw:text-box></draw:frame></draw:page>
</office:presentation></office:body></office:document-content>`

    const slide = readOdpSlides(zipSync({ 'content.xml': strToU8(content) }))[0]
    expect(slide.title).toBe('Results')
    expect(slide.lines).toEqual(['Yield up 12%'])
  })
})

describe('documents', () => {
  it('strips scripts, handlers and javascript links from converted html', () => {
    const html = sanitiseDocumentHtml(
      '<p onclick="x()">Hi <a href="javascript:alert(1)">bad</a> <a href="https://example.org">ok</a></p><script>alert(1)</script><img src="x" onerror="y()">',
    )

    expect(html).not.toContain('script')
    expect(html).not.toContain('onclick')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('turns odt text into escaped html', () => {
    const content = `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text>
<text:h text:outline-level="1">Method</text:h><text:p>Mix 5 &lt; 6 &amp; stir</text:p></office:text></office:body></office:document-content>`

    const html = readOdtHtml(zipSync({ 'content.xml': strToU8(content) }))
    expect(html).toContain('<h1>Method</h1>')
    expect(html).toContain('Mix 5 &lt; 6 &amp; stir')
  })
})
