import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { DocumentView } from '#/components/notebook/office-preview/document-view'
import PdfView from '#/components/notebook/office-preview/pdf-view'
import { SheetView } from '#/components/notebook/office-preview/sheet-view'
import { SlidesView } from '#/components/notebook/office-preview/slides-view'

/**
 * The four views an Office file block draws its preview with: a workbook, a
 * converted document, slides and a PDF. Each takes already-read content, so the
 * stories hand them literals: nothing is downloaded or parsed.
 */
const sheets = [
  {
    name: 'Plate 1',
    rows: [
      ['Well', 'OD600', 'Strain'],
      ['A1', '0.412', 'WT'],
      ['A2', '0.398', 'WT'],
      ['B1', '0.655', 'ΔrecA'],
    ],
    totalRows: 4,
    totalColumns: 3,
  },
  {
    name: 'Summary',
    rows: [
      ['Strain', 'Mean'],
      ['WT', '0.405'],
      ['ΔrecA', '0.663'],
    ],
    totalRows: 3,
    totalColumns: 2,
  },
]

const html = `<h1>Growth assay report</h1>
<p>Cultures were grown in <strong>LB</strong> at 37 °C and read every 30 minutes.</p>
<h2>Results</h2>
<ul><li>Wild type reached stationary phase after 6 hours.</li><li>The knockout lagged by about an hour.</li></ul>
<table><tr><th>Strain</th><th>Doubling time</th></tr><tr><td>WT</td><td>28 min</td></tr><tr><td>ΔrecA</td><td>34 min</td></tr></table>`

const slides = [
  {
    number: 1,
    title: 'Growth assay',
    lines: ['Plate reader run 14', 'October 2026'],
    images: [],
  },
  {
    number: 2,
    title: 'Findings',
    lines: [
      'Knockout grows more slowly',
      'Effect is reproducible across plates',
    ],
    images: [],
  },
]

/** A one-page PDF, written out by hand so the story needs no file. */
function tinyPdf(): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 160] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length 56 >>\nstream\nBT /F1 20 Tf 30 80 Td (Growth assay report) Tj ET\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]

  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`

  for (const offset of offsets) {
    out += `${String(offset).padStart(10, '0')} 00000 n \n`
  }

  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`

  return new TextEncoder().encode(out)
}

const meta = {
  title: 'Notebook/Office preview views',
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[640px] max-w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

/** A workbook with two worksheets, one tab each. */
export const Workbook: Story = {
  render: () => <SheetView sheets={sheets} name="plate-reader.xlsx" />,
}

/** A workbook with a single worksheet shows no tabs. */
export const SingleSheet: Story = {
  render: () => (
    <SheetView sheets={sheets.slice(0, 1)} name="plate-reader.xlsx" />
  ),
}

/** A workbook with no worksheets. */
export const EmptyWorkbook: Story = {
  render: () => <SheetView sheets={[]} name="empty.xlsx" />,
}

/** A converted Word document. */
export const Document: Story = { render: () => <DocumentView html={html} /> }

/** Slides as text, one card each. */
export const Slides: Story = { render: () => <SlidesView slides={slides} /> }

/** A PDF drawn one page at a time. */
export const Pdf: Story = {
  render: () => <PdfView bytes={tinyPdf()} name="report.pdf" />,
}
