/**
 * The signed record as a document a person reads: a cover that says what the
 * record is and who signed it, then the notebook in the order it was written
 * (headings, steps, materials, key numbers, the conclusion, the sheets with
 * their number formats), then an appendix that names the attached files and the
 * integrity digest. Rendered from the frozen revision, never from live reads.
 *
 * pdf-lib with the standard fonts keeps the output deterministic and free of a
 * browser; characters outside WinAnsi are mapped by `safeText`.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { PDFFont, PDFPage } from 'pdf-lib'
import { z } from 'zod'

import { safeText } from '#/lib/client-portal-pdf'
import { formatMagnitude } from '#/lib/format-numbers'
import { drawFigure, figureHeight } from './figure-draw'
import type { PdfFigure } from './chart-figure'
import { frozenSheetGridFromEvidence } from '#/lib/frozen-sheet-grid'
import { sheetEvidenceFromEnvelope } from '#/lib/sheet-evidence'

const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN = 54
const FOOTER = 34
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2

const ink = rgb(0.09, 0.1, 0.12)
const muted = rgb(0.4, 0.43, 0.48)
const rule = rgb(0.84, 0.85, 0.87)
const tint = rgb(0.95, 0.96, 0.97)
const good = rgb(0.1, 0.45, 0.25)
const warn = rgb(0.65, 0.4, 0.05)

export interface ReportSignature {
  signerName: string | null
  signedAt: string
  meaning: string
  authMethod: string
}

/** What the report needs of an evidence package; every field beyond the digest is optional. */
export interface ReportInput {
  identifier: string
  title: string
  kind: string
  recordStatus: string | null
  revisionId: string
  reason: string | null
  capturedAt: string | null
  structureVersion: string
  integrityDigest: string | null
  verificationCode: string | null
  signatures: ReportSignature[]
  blockSnapshot: unknown
  sheetEvidence: unknown
  files: Array<{ id: string; checksum: string; byteSize: string }>
  workspaceName?: string
  userNames?: ReadonlyMap<string, string>
  /** Drawn figures by block id; blocks without one point to the notebook. */
  figures?: ReadonlyMap<string, PdfFigure>
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/** `21 Sep 2026, 13:10 UTC`: unambiguous and the same wherever it is read. */
export function reportDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')

  return `${parsed.getUTCDate()} ${MONTHS[parsed.getUTCMonth()]} ${parsed.getUTCFullYear()}, ${pad(parsed.getUTCHours())}:${pad(parsed.getUTCMinutes())} UTC`
}

const MEANING_WORDS = new Map([
  ['reviewed-and-approved', 'Reviewed and approved'],
  ['authored', 'Authored'],
  ['witnessed', 'Witnessed'],
  ['approved', 'Approved'],
])

export function meaningWords(meaning: string): string {
  return (
    MEANING_WORDS.get(meaning) ??
    meaning.replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase())
  )
}

interface ProseNode {
  type?: string
  text?: string
  attrs?: { level?: number }
  marks?: Array<{ type?: string }>
  content?: ProseNode[]
}

const proseNode: z.ZodType<ProseNode> = z.lazy(() =>
  z.object({
    type: z.string().optional(),
    text: z.string().optional(),
    attrs: z.object({ level: z.number().optional() }).loose().optional(),
    marks: z
      .array(z.object({ type: z.string().optional() }).loose())
      .optional(),
    content: z.array(proseNode).optional(),
  }),
)

const blockSchema = z.object({
  id: z.string().optional(),
  type: z.string(),
  order: z.number().optional(),
  payload: z.record(z.string(), z.json()).catch({}),
})

type Block = z.infer<typeof blockSchema>

function textOf(node: ProseNode | undefined): string {
  if (!node) return ''

  return (node.text ?? '') + (node.content ?? []).map(textOf).join('')
}

type Payload = Record<string, z.infer<typeof z.json>>

/** A stored value that is one cell of text or a number. */
type Cell =
  | string
  | number
  | boolean
  | null
  | undefined
  | Cell[]
  | { [key: string]: Cell }

const cellValue = z
  .union([z.string(), z.number(), z.boolean(), z.null()])
  .catch(null)

const text = z
  .string()
  .catch('')
  .transform((v) => v.trim())

/** One cell of a stored table: numbers read the way a scientist writes them. */
function reportCell(raw: Cell): string {
  const n = z.number().safeParse(raw)

  if (n.success) return formatMagnitude(n.data) ?? String(n.data)

  return text.parse(raw)
}

/** The columns whose every filled cell is a number or a magnitude, so they align right. */
function numericColumns(count: number, rows: string[][]): Set<number> {
  const out = new Set<number>()

  for (let i = 0; i < count; i++)
    if (rows.every((r) => !r[i] || /^[-\d.,\s×⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+$/.test(r[i])))
      out.add(i)

  return out
}

/** The stored text of a payload field, or an empty string. */
function field(payload: Payload, key: string): string {
  return text.parse(payload[key])
}

function quantityText(raw: Cell): string {
  const n = z.number().safeParse(raw)

  if (n.success) return formatMagnitude(n.data) ?? String(n.data)

  return text.parse(raw)
}

class Layout {
  readonly pdf: PDFDocument
  page: PDFPage
  y = PAGE_HEIGHT - MARGIN

  constructor(
    pdf: PDFDocument,
    readonly regular: PDFFont,
    readonly bold: PDFFont,
    readonly mono: PDFFont,
  ) {
    this.pdf = pdf
    this.page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  }

  newPage(): void {
    this.page = this.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    this.y = PAGE_HEIGHT - MARGIN
  }

  ensure(height: number): void {
    if (this.y - height < MARGIN + FOOTER) this.newPage()
  }

  /** Greedy wrap by the font's real widths. */
  wrap(value: string, font: PDFFont, size: number, width: number): string[] {
    const lines: string[] = []

    for (const paragraph of safeText(value).split(/\n/)) {
      let current = ''

      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const next = current ? `${current} ${word}` : word

        if (font.widthOfTextAtSize(next, size) <= width || !current) {
          current = next
        } else {
          lines.push(current)
          current = word
        }
      }

      lines.push(current)
    }

    return lines
  }

  paragraph(
    value: string,
    opts: {
      font?: PDFFont
      size?: number
      color?: ReturnType<typeof rgb>
      indent?: number
      gap?: number
    } = {},
  ): void {
    const font = opts.font ?? this.regular
    const size = opts.size ?? 10
    const indent = opts.indent ?? 0

    for (const line of this.wrap(value, font, size, CONTENT_WIDTH - indent)) {
      this.ensure(size + 4)
      this.page.drawText(line, {
        x: MARGIN + indent,
        y: this.y - size,
        size,
        font,
        color: opts.color ?? ink,
      })
      this.y -= size * 1.45
    }

    this.y -= opts.gap ?? 4
  }

  heading(value: string, level: 1 | 2 | 3): void {
    const size = level === 1 ? 15 : level === 2 ? 12.5 : 10.5
    this.ensure(size + 24)
    this.y -= level === 1 ? 14 : 8
    this.paragraph(value, { font: this.bold, size, gap: 3 })

    if (level === 1) {
      this.page.drawLine({
        start: { x: MARGIN, y: this.y + 2 },
        end: { x: PAGE_WIDTH - MARGIN, y: this.y + 2 },
        thickness: 0.6,
        color: rule,
      })
      this.y -= 6
    }
  }

  rule(): void {
    this.ensure(10)
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_WIDTH - MARGIN, y: this.y },
      thickness: 0.5,
      color: rule,
    })
    this.y -= 10
  }

  /** A table that wraps its cells and repeats the header on each page. */
  table(
    head: string[],
    rows: string[][],
    opts: { rightAlign?: Set<number>; size?: number; headless?: boolean } = {},
  ): void {
    const size = opts.size ?? 8.5
    const cols = head.length

    if (cols === 0) return

    // Width follows the longest content of a column, kept between bounds.
    const longest = head.map((h, i) =>
      Math.max(
        h.length,
        ...rows.map((r) => Math.min((r[i] ?? '').length, 28)),
        4,
      ),
    )

    const total = longest.reduce((a, b) => a + b, 0)
    const widths = longest.map((l) => (l / total) * CONTENT_WIDTH)

    const drawRow = (cells: string[], bold: boolean, fill: boolean): void => {
      const font = bold ? this.bold : this.regular

      const wrapped = cells.map((c, i) =>
        this.wrap(c, font, size, widths[i] - 8).slice(0, 6),
      )

      const lines = Math.max(1, ...wrapped.map((w) => w.length))
      const height = lines * size * 1.3 + 7

      if (this.y - height < MARGIN + FOOTER) {
        this.newPage()

        if (!bold && !opts.headless) drawRow(head, true, true)
      }

      if (fill)
        this.page.drawRectangle({
          x: MARGIN,
          y: this.y - height,
          width: CONTENT_WIDTH,
          height,
          color: tint,
        })

      let x = MARGIN

      wrapped.forEach((lineSet, i) => {
        lineSet.forEach((line, n) => {
          const w = font.widthOfTextAtSize(line, size)

          this.page.drawText(line, {
            x: opts.rightAlign?.has(i) ? x + widths[i] - 4 - w : x + 4,
            y: this.y - size - 3 - n * size * 1.3,
            size,
            font,
            color: ink,
          })
        })
        x += widths[i]
      })

      this.y -= height
      this.page.drawLine({
        start: { x: MARGIN, y: this.y },
        end: { x: PAGE_WIDTH - MARGIN, y: this.y },
        thickness: 0.4,
        color: rule,
      })
    }

    if (!opts.headless) drawRow(head, true, true)

    for (const row of rows) {
      drawRow(
        head.map((_, i) => safeText(row[i] ?? '')),
        false,
        false,
      )
    }

    this.y -= 8
  }
}

function drawProse(layout: Layout, nodes: ProseNode[], depth = 0): void {
  for (const node of nodes) {
    const value = textOf(node).replace(/\s+/g, ' ').trim()

    if (node.type === 'heading') {
      const level = node.attrs?.level ?? 2
      layout.heading(value, level <= 1 ? 2 : 3)
    } else if (node.type === 'bulletList' || node.type === 'orderedList') {
      ;(node.content ?? []).forEach((item, n) => {
        const label = node.type === 'orderedList' ? `${n + 1}.` : '•'

        layout.paragraph(
          `${label}  ${textOf(item).replace(/\s+/g, ' ').trim()}`,
          {
            indent: 10 + depth * 10,
            gap: 1,
          },
        )
      })
      layout.y -= 3
    } else if (node.type === 'blockquote') {
      layout.paragraph(value, { color: muted, indent: 12 })
    } else if (node.type === 'codeBlock') {
      layout.paragraph(textOf(node), { font: layout.mono, size: 9 })
    } else if (value) {
      layout.paragraph(value)
    }
  }
}

function userName(input: ReportInput, id: Cell): string {
  const key = z.string().safeParse(id)

  return key.success ? (input.userNames?.get(key.data) ?? '') : ''
}

function drawBlock(
  layout: Layout,
  input: ReportInput,
  block: Block,
  sheets: ReturnType<typeof sheetEvidenceFromEnvelope>,
  stepNumberOffset: { shown: boolean },
): void {
  const p = block.payload

  switch (block.type) {
    case 'rich_text': {
      const doc = z
        .object({ content: z.array(proseNode).optional() })
        .safeParse(p.doc)

      if (doc.success) drawProse(layout, doc.data.content ?? [])
      break
    }

    case 'procedure_step': {
      if (!stepNumberOffset.shown) {
        layout.heading('Procedure', 2)
        stepNumberOffset.shown = true
      }

      layout.ensure(48)
      const done = p.completed === true

      const who = done
        ? [
            userName(input, p.completedByUserId),
            reportDateTime(
              z.string().nullable().catch(null).parse(p.completedAt),
            ),
          ]
            .filter(Boolean)
            .join(', ')
        : ''

      layout.paragraph(
        `${done ? '[x]' : '[ ]'}  Step ${text.parse(String(z.number().catch(0).parse(p.stepNumber)))}: ${field(p, 'text')}`,
        { font: layout.bold, size: 10, gap: 1 },
      )

      const detail = [
        field(p, 'note'),
        done ? `Completed ${who}` : 'Not completed in this revision',
      ]
        .filter(Boolean)
        .join('  ·  ')

      layout.paragraph(detail, {
        size: 9,
        color: done ? muted : warn,
        indent: 18,
      })
      break
    }

    case 'materials': {
      const items = z
        .array(z.record(z.string(), z.unknown()))
        .catch([])
        .parse(p.items)

      if (items.length === 0) break
      layout.heading('Materials and samples', 2)
      layout.table(
        ['ID', 'Name', 'Quantity'],
        items.map((item) => {
          const unit = z
            .object({
              symbol: z.string().optional(),
              code: z.string().optional(),
            })
            .safeParse(item.unit)

          const symbol = unit.success
            ? (unit.data.symbol ?? unit.data.code ?? '')
            : ''

          return [
            text.parse(item.identifier),
            text.parse(item.title),
            `${quantityText(cellValue.parse(item.quantity))} ${symbol}`.trim(),
          ]
        }),
        { rightAlign: new Set([2]) },
      )
      break
    }

    case 'metric': {
      const value = field(p, 'value')

      if (!value) break
      layout.paragraph(
        `${field(p, 'label')}:  ${quantityText(p.value)} ${field(p, 'unit')}`.trim(),
        { font: layout.bold, size: 11, gap: 1 },
      )

      if (field(p, 'provenance'))
        layout.paragraph(field(p, 'provenance'), {
          size: 9,
          color: muted,
          indent: 0,
        })
      break
    }

    case 'conclusion': {
      const verdict = field(p, 'verdict')

      layout.heading(
        verdict ? `Conclusion: ${meaningWords(verdict)}` : 'Conclusion',
        2,
      )
      layout.paragraph(field(p, 'text'))

      if (field(p, 'basis'))
        layout.paragraph(`Based on ${field(p, 'basis')}`, {
          size: 9,
          color: muted,
        })
      break
    }

    case 'sheet': {
      const evidence =
        sheets.get(block.id ?? '') ??
        [...sheets.values()].find((s) => s.instanceId === p.instanceId)

      if (!evidence) {
        layout.paragraph('Sheet content was not captured in this revision.', {
          color: muted,
        })
        break
      }

      const grid = frozenSheetGridFromEvidence(evidence)

      layout.heading('Sheet', 3)
      layout.table(
        grid.columns.map((c) => c.label),
        grid.rows,
        {
          size: grid.columns.length > 7 ? 7.5 : 8.5,
          rightAlign: numericColumns(grid.columns.length, grid.rows),
        },
      )
      break
    }

    case 'plate_run': {
      const pinned = z.record(z.string(), z.unknown()).catch({}).parse(p.pinned)

      layout.heading(`Plate run ${text.parse(pinned.reference)}`, 3)

      const hits = z.number().safeParse(pinned.hitSamples)
      const tested = z.number().safeParse(pinned.testedSamples)
      const z0 = z.number().safeParse(pinned.zPrime)

      layout.paragraph(
        [
          text.parse(pinned.name),
          z0.success ? `Z' ${z0.data.toFixed(2)}` : '',
          hits.success && tested.success
            ? `${hits.data} hits of ${tested.data} samples tested`
            : '',
          text.parse(pinned.qcStatus)
            ? `QC ${text.parse(pinned.qcStatus)}`
            : '',
        ]
          .filter(Boolean)
          .join('  ·  '),
      )
      break
    }

    case 'callout': {
      const body = field(p, 'text') || field(p, 'title')

      if (body) layout.paragraph(body, { color: muted, indent: 8 })
      break
    }

    case 'table': {
      const columns = z
        .array(z.unknown())
        .catch([])
        .parse(p.columns)
        .map((c) => text.parse(c))

      const rows = z
        .array(z.array(cellValue))
        .catch([])
        .parse(p.rows)
        .map((row) => row.map((cell) => reportCell(cell)))

      if (columns.length === 0) break
      layout.table(columns, rows, {
        size: columns.length > 7 ? 7.5 : 8.5,
        rightAlign: numericColumns(columns.length, rows),
      })
      break
    }

    case 'checklist': {
      const items = z
        .array(
          z.object({
            text: z.string().catch(''),
            checked: z.boolean().catch(false),
          }),
        )
        .catch([])
        .parse(p.items)

      for (const item of items)
        layout.paragraph(`${item.checked ? '[x]' : '[ ]'}  ${item.text}`, {
          gap: 1,
        })
      layout.y -= 3
      break
    }

    case 'analysis':
    case 'chart': {
      const frozen = z
        .object({
          datasetProvenance: z
            .array(
              z.object({
                rowCount: z.number().optional(),
                checksum: z.string().optional(),
              }),
            )
            .catch([]),
        })
        .safeParse(p.frozen)

      const source = frozen.success
        ? frozen.data.datasetProvenance[0]
        : undefined

      layout.paragraph(
        `${block.type === 'analysis' ? 'Analysis' : 'Chart'}: ${field(p, 'title') || 'untitled'}`,
        { font: layout.bold, size: 10, gap: 1 },
      )

      const figure = block.id ? input.figures?.get(block.id) : undefined

      if (figure) {
        const height = figureHeight(figure)

        layout.ensure(height + 6)
        drawFigure(layout.page, layout.regular, figure, {
          x: MARGIN,
          y: layout.y - height,
          width: CONTENT_WIDTH,
          height,
        })
        layout.y -= height + 6
      }

      layout.paragraph(
        source
          ? `Pinned to a dataset version of ${source.rowCount ?? '?'} rows${source.checksum ? ` (checksum ${source.checksum.slice(0, 12)})` : ''}.${figure ? '' : ' The figure is in the notebook.'}`
          : figure
            ? ''
            : 'The figure is in the notebook.',
        { size: 9, color: muted },
      )
      break
    }

    default:
      break
  }
}

function cover(layout: Layout, input: ReportInput): void {
  const signed = input.signatures.length > 0

  layout.page.drawText(
    safeText(
      `${input.workspaceName ? `${input.workspaceName}  ·  ` : ''}${signed ? 'Signed record' : 'Submitted record, not signed'}`,
    ),
    {
      x: MARGIN,
      y: layout.y - 10,
      size: 9.5,
      font: layout.regular,
      color: muted,
    },
  )
  layout.y -= 30
  layout.paragraph(input.identifier, {
    font: layout.mono,
    size: 11,
    color: muted,
    gap: 2,
  })
  layout.paragraph(input.title, { font: layout.bold, size: 20, gap: 8 })

  layout.paragraph(
    signed ? 'Approved and signed' : 'Submitted, awaiting signature',
    { font: layout.bold, size: 11, color: signed ? good : warn, gap: 10 },
  )

  layout.table(
    ['', ''],
    [
      ['Kind', input.kind],
      [
        'Revision captured',
        `${reportDateTime(input.capturedAt)}  (${input.reason ?? 'submit'})`,
      ],
      ['Notebook structure version', input.structureVersion],
    ],
    { size: 9.5, headless: true },
  )

  layout.heading('Signatures', 2)

  if (signed) {
    layout.table(
      ['Signed by', 'Meaning', 'Signed at', 'Method'],
      input.signatures.map((s) => [
        s.signerName ?? 'Name not recorded',
        meaningWords(s.meaning),
        reportDateTime(s.signedAt),
        s.authMethod === 'demo' ? 'Demo (not a real signature)' : s.authMethod,
      ]),
      { size: 9.5 },
    )
  } else {
    layout.paragraph('No one has signed this revision yet.', { color: muted })
  }

  layout.heading('Integrity', 2)

  if (input.integrityDigest) {
    layout.paragraph('This revision is sealed. Its SHA-256 digest:', {
      size: 9.5,
      color: muted,
      gap: 1,
    })
    layout.paragraph(input.integrityDigest, { font: layout.mono, size: 8.5 })
  }

  if (input.verificationCode)
    layout.paragraph(`Verification code  ${input.verificationCode}`, {
      font: layout.mono,
      size: 11,
    })
}

function appendix(layout: Layout, input: ReportInput): void {
  layout.heading('Appendix: attached files and integrity', 1)

  if (input.files.length > 0) {
    layout.table(
      ['File', 'Size (bytes)', 'SHA-256'],
      input.files.map((f, n) => [`File ${n + 1}`, f.byteSize, f.checksum]),
      { size: 7.5, rightAlign: new Set([1]) },
    )
  } else {
    layout.paragraph('No files were attached to this revision.', {
      color: muted,
    })
  }

  layout.paragraph(
    `Revision ${input.revisionId}. Check this document against the audit trail with the digest and verification code on the first page.`,
    { size: 9, color: muted },
  )
}

export async function renderRecordReportPdf(
  input: ReportInput,
  render: { logo?: { bytes: Uint8Array; mediaType: string } | null } = {},
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(safeText(`${input.identifier} - ${input.title}`))
  pdf.setProducer('Sheetbase')
  pdf.setCreationDate(new Date(0))
  pdf.setModificationDate(new Date(0))

  const [regular, bold, mono] = await Promise.all([
    pdf.embedFont(StandardFonts.Helvetica),
    pdf.embedFont(StandardFonts.HelveticaBold),
    pdf.embedFont(StandardFonts.Courier),
  ])

  const layout = new Layout(pdf, regular, bold, mono)

  const logo = render.logo
    ? await (
        render.logo.mediaType === 'image/png'
          ? pdf.embedPng(render.logo.bytes)
          : pdf.embedJpg(render.logo.bytes)
      ).catch(() => null)
    : null

  if (logo) {
    const scale = Math.min(36 / logo.height, 150 / logo.width)
    const width = logo.width * scale
    const height = logo.height * scale
    layout.page.drawImage(logo, {
      x: PAGE_WIDTH - MARGIN - width,
      y: PAGE_HEIGHT - MARGIN - height + 6,
      width,
      height,
    })
  }

  cover(layout, input)

  layout.newPage()
  layout.heading('Notebook', 1)

  const blocks = z
    .array(blockSchema)
    .catch([])
    .parse(input.blockSnapshot)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  const sheets = sheetEvidenceFromEnvelope({
    sheetEvidence: input.sheetEvidence,
  })

  const state = { shown: false }

  for (const block of blocks) {
    // A run of steps is introduced once; any other block ends the run.
    if (block.type !== 'procedure_step') state.shown = false

    drawBlock(layout, input, block, sheets, state)
  }

  layout.newPage()
  appendix(layout, input)

  const pages = pdf.getPages()

  pages.forEach((page, index) => {
    const label = safeText(
      `${input.identifier}  ·  ${input.verificationCode ? `code ${input.verificationCode}  ·  ` : ''}page ${index + 1} of ${pages.length}`,
    )

    page.drawLine({
      start: { x: MARGIN, y: MARGIN },
      end: { x: PAGE_WIDTH - MARGIN, y: MARGIN },
      thickness: 0.4,
      color: rule,
    })
    page.drawText(label, {
      x: MARGIN,
      y: MARGIN - 13,
      size: 8,
      font: regular,
      color: muted,
    })
  })

  return await pdf.save()
}
