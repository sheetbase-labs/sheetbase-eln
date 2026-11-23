import { describe, expect, it } from 'vitest'

import { renderReportDocx } from './report-docx'
import {
  frozenParagraphs,
  parseReportHtml,
  reportFileName,
  shortFingerprint,
} from './report-document'
import { renderReportPdf } from './report-pdf'

const frozen = JSON.stringify({
  block: {
    id: 'b1',
    type: 'rich_text',
    payload: {
      doc: {
        type: 'doc',
        content: [
          { type: 'heading', content: [{ type: 'text', text: 'Method' }] },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Cells were seeded at 2e5/mL.' }],
          },
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Viability above 95%' }],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  },
  revisionDigest: 'a'.repeat(64),
})

const html = `<!DOCTYPE html>
<html lang="en"><head><title>Titre &amp; co</title></head><body>
<h1>Titre &amp; co</h1>
<p class="subtitle">A subtitle</p>
<p class="meta">REP-0001 · v3</p>
<section>
<h2>1. Method</h2>
<p>Why we ran it</p>
<p class="meta">Source: notebook_block · revision 1a2b3c4d · status valid</p>
<pre>${frozen.replace(/</g, '&lt;')}</pre>
</section>
</body></html>`

const current = `<!DOCTYPE html>
<html lang="en"><head><title>R &amp; D</title></head><body>
<h1>R &amp; D</h1>
<p class="meta">REP-0002 · v1</p>
<section>
<h2>1. Titre</h2>
<p class="body">First line &lt;ok&gt;
Second line</p>
<p class="meta">From EXP-0004 · revision 1a2b3c4d</p>
</section>
</body></html>`

const info = {
  checksum: 'abcdef0123456789'.repeat(4),
  generatedAt: '2026-11-23T10:00:00Z',
}

describe('report documents', () => {
  it('reads the stored document', () => {
    const doc = parseReportHtml(html, info)

    expect(doc.title).toBe('Titre & co')
    expect(doc.subtitle).toBe('A subtitle')
    expect(doc.meta).toBe('REP-0001 · v3')
    expect(doc.fingerprint).toBe(shortFingerprint(info.checksum))
    expect(doc.sections).toHaveLength(1)
    expect(doc.sections[0]?.body.map((b) => b.kind)).toEqual([
      'text',
      'meta',
      'heading',
      'text',
      'bullet',
      'code',
    ])
  })

  it('reads the document the database writes now, in order', () => {
    const doc = parseReportHtml(current, info)

    expect(doc.title).toBe('R & D')
    expect(doc.subtitle).toBeNull()
    expect(doc.sections[0]?.heading).toBe('1. Titre')
    expect(doc.sections[0]?.body).toEqual([
      { kind: 'text', text: 'First line <ok>' },
      { kind: 'text', text: 'Second line' },
      { kind: 'meta', text: 'From EXP-0004 · revision 1a2b3c4d' },
    ])
  })

  it('shows a note instead of JSON for evidence without words', () => {
    const out = frozenParagraphs(
      JSON.stringify({ block: { type: 'chart', payload: { series: [] } } }),
    )

    expect(out[0]?.text).toContain('chart')
  })

  it('names files from the identifier', () => {
    expect(reportFileName('REP 0001/x', 2, 'docx')).toBe('REP-0001-x-v2.docx')
  })

  it('renders a PDF and a Word file', async () => {
    const doc = parseReportHtml(html, info)
    const pdf = await renderReportPdf(doc)
    const docx = await renderReportDocx(doc)

    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-')
    expect(docx[0]).toBe(0x50)
    expect(docx[1]).toBe(0x4b)
  })
})
