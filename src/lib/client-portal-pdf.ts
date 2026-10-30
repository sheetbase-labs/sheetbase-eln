/**
 * PORTAL-02.3 — the approved-record PDF a client downloads from the portal.
 *
 * The bytes are built from the guarded document payload
 * (`client_portal_record_document`), never from live reads: the content is the
 * signed revision's frozen blocks and the signature page carries the signer,
 * the signed time and a verification code derived from the revision integrity
 * digest. A client who has the code can check it against the CDMO audit trail.
 *
 * Rendering is deliberately plain (pdf-lib standard fonts, a single column) so
 * the output is deterministic and testable; the portal's download button, not
 * the renderer, owns presentation.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { z } from 'zod'

import type { ClientPortalRecordDocument } from '#/lib/client-portal'
import {
  formatFrozenCell,
  frozenSheetGridFromEvidence,
} from '#/lib/frozen-sheet-grid'
import { sheetEvidenceFromEnvelope } from '#/lib/sheet-evidence'

const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN = 56
const BODY_CHARS = 92

const ink = rgb(0.07, 0.08, 0.1)
const muted = rgb(0.42, 0.45, 0.5)
const rule = rgb(0.85, 0.86, 0.88)

const scientificTablesSchema = z.array(
  z.object({
    name: z.string(),
    columns: z.array(z.object({ field_name: z.string(), label: z.string() })),
    rows: z.array(z.record(z.string(), z.unknown())),
  }),
)

/** Flatten a ProseMirror-style node to its text, inline children joined. */
function nodeText(node: unknown): string {
  if (Array.isArray(node)) return node.map(nodeText).join('')
  if (!node || typeof node !== 'object') return ''
  const record = node as Record<string, unknown>
  const own = typeof record.text === 'string' ? record.text : ''
  const children = Array.isArray(record.content)
    ? (record.content as unknown[]).map(nodeText).join('')
    : ''
  return own + children
}

/**
 * Plain-text lines for the record body. Frozen blocks carry rich-text payloads
 * (payload.doc) and file/link references; only text is rendered, one top-level
 * document node per line.
 */
export function blockSnapshotLines(snapshot: unknown): string[] {
  if (!Array.isArray(snapshot)) return []
  const lines: string[] = []
  for (const block of snapshot) {
    if (!block || typeof block !== 'object') continue
    const payload = (block as Record<string, unknown>).payload as
      Record<string, unknown> | undefined
    const doc = payload?.doc as Record<string, unknown> | undefined
    if (!Array.isArray(doc?.content)) continue
    for (const node of doc.content as unknown[]) {
      const text = nodeText(node).replace(/\s+/g, ' ').trim()
      if (text) lines.push(text)
    }
  }
  return lines
}

/** Section payloads of a report are JSON blobs; render their text compactly. */
function reportSectionLines(payload: unknown): string[] {
  if (payload === null || payload === undefined) return []
  if (typeof payload === 'string') return payload.trim() ? [payload] : []
  const text = nodeText(payload).replace(/\s+/g, ' ').trim()
  return text ? [text] : [JSON.stringify(payload)]
}

/** Greedy word wrap to a fixed character width for the standard font. */
function wrap(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if (!current) {
      current = word
    } else if (current.length + 1 + word.length <= maxChars) {
      current = `${current} ${word}`
    } else {
      lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  return lines.length ? lines : ['']
}

const MONTHS_SHORT = [
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

function asDate(value: string | null): string {
  if (!value) return '—'
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return '—'
  const date = new Date(parsed)
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()}`
}

/**
 * The standard fonts encode WinAnsi only. Frozen content can carry scientific
 * notation (× 10⁶, µg, ≤); map the common cases to ASCII and drop anything
 * else rather than fail the download.
 */
const WIN_ANSI_FALLBACK: Record<string, string> = {
  '\u2070': '^0',
  '\u00b9': '^1',
  '\u00b2': '^2',
  '\u00b3': '^3',
  '\u2074': '^4',
  '\u2075': '^5',
  '\u2076': '^6',
  '\u2077': '^7',
  '\u2078': '^8',
  '\u2079': '^9',
  '\u207b': '^-',
  '\u207a': '^+',
  '\u00d7': 'x',
  '\u00b5': 'u',
  '\u03bc': 'u',
  '\u2264': '<=',
  '\u2265': '>=',
  '\u2192': '->',
  '\u2013': '-',
  '\u2014': '-',
  '\u2018': "'",
  '\u2019': "'",
  '\u201c': '"',
  '\u201d': '"',
  '\u2026': '...',
}

function safeText(value: string): string {
  let out = ''
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code <= 0xff) {
      out += char
      continue
    }
    out += WIN_ANSI_FALLBACK[char] ?? ''
  }
  return out
}

/**
 * Render one approved record/report document to PDF bytes. The first page is
 * the metadata strip; the body follows; the last page is the signature page
 * (records) or the report sections.
 */
export async function renderClientPortalRecordPdf(
  doc: ClientPortalRecordDocument,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`${doc.identifier} - ${doc.title}`)
  pdf.setProducer('Sheetbase client portal')
  pdf.setCreationDate(new Date(0))

  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const mono = await pdf.embedFont(StandardFonts.Courier)

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  let y = PAGE_HEIGHT - MARGIN

  const ensureSpace = (needed: number): void => {
    if (y - needed < MARGIN) {
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT])
      y = PAGE_HEIGHT - MARGIN
    }
  }

  const text = (
    value: string,
    options: { font?: typeof regular; size?: number; color?: typeof ink } = {},
  ): void => {
    const font = options.font ?? regular
    const size = options.size ?? 10.5
    for (const line of wrap(safeText(value), BODY_CHARS)) {
      ensureSpace(size + 4)
      page.drawText(line, {
        x: MARGIN,
        y,
        size,
        font,
        color: options.color ?? ink,
      })
      y -= size + 4
    }
  }

  const heading = (value: string): void => {
    ensureSpace(26)
    y -= 6
    page.drawText(safeText(value), {
      x: MARGIN,
      y,
      size: 13,
      font: bold,
      color: ink,
    })
    y -= 18
  }

  page.drawText('Sheetbase · approved record', {
    x: MARGIN,
    y,
    size: 9,
    font: regular,
    color: muted,
  })
  y -= 22
  heading(`${doc.identifier} — ${doc.title}`)
  text(`Project: ${doc.projectTitle}`, { color: muted, size: 10 })
  text(
    doc.approvedAt ? `Approved ${asDate(doc.approvedAt)}` : 'Approved record',
    { color: muted, size: 10 },
  )
  if (doc.verificationCode) {
    text(`Verification code: ${doc.verificationCode}`, { font: mono, size: 11 })
  }

  ensureSpace(12)
  page.drawLine({
    start: { x: MARGIN, y: y - 4 },
    end: { x: PAGE_WIDTH - MARGIN, y: y - 4 },
    thickness: 0.5,
    color: rule,
  })
  y -= 18

  if (doc.kind === 'report' && doc.reportSections.length) {
    heading('Report sections')
    for (const section of doc.reportSections) {
      text(section.title, { font: bold, size: 10.5 })
      if (section.description) text(section.description, { size: 10 })
      for (const line of reportSectionLines(section.payload)) {
        text(line, { size: 10, color: muted })
      }
      y -= 6
    }
  } else {
    heading('Content')
    const lines = blockSnapshotLines(doc.blockSnapshot)
    if (lines.length) {
      for (const line of lines) text(line)
    } else {
      text('No frozen content is attached to this document.', { color: muted })
    }
    const tables = scientificTablesSchema.safeParse(doc.scientificTables ?? [])
    if (!tables.success) {
      text('Frozen scientific table evidence could not be read.', {
        color: muted,
      })
    } else {
      for (const table of tables.data) {
        heading(`Frozen table: ${table.name}`)
        text(table.columns.map((column) => column.label).join(' | '), {
          font: bold,
        })
        for (const row of table.rows) {
          text(
            table.columns
              .map(
                (column) =>
                  `${column.label}: ${formatFrozenCell(row[column.field_name])}`,
              )
              .join(' | '),
          )
        }
      }
    }
    for (const evidence of sheetEvidenceFromEnvelope({
      sheetEvidence: doc.sheetEvidence,
    }).values()) {
      const grid = frozenSheetGridFromEvidence(evidence)
      heading(`Frozen Sheet: ${evidence.blockId}`)
      text(`Instance revision: ${evidence.instanceRevision}`, {
        size: 10,
        color: muted,
      })
      text(grid.columns.map((column) => column.label).join(' | '), {
        font: bold,
      })
      for (const row of grid.rows) {
        text(
          grid.columns
            .map((column, index) => `${column.label}: ${row[index] ?? ''}`)
            .join(' | '),
        )
      }
    }
  }

  page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  y = PAGE_HEIGHT - MARGIN
  heading('Signature page')
  if (doc.signatures?.length) {
    for (const signature of doc.signatures) {
      heading(signature.signerName ?? 'Signer name not recorded')
      text(`Signature ID: ${signature.id}`, { font: mono, size: 9 })
      text(`Revision ID: ${signature.revisionId}`, { font: mono, size: 9 })
      text(`Signed at: ${signature.signedAt}`, { size: 10 })
      text(`Meaning: ${signature.signatureMeaning}`, { size: 10 })
      if (signature.authMethod === 'demo')
        text('Demo signature: made in the demo, not a real signature.', {
          font: bold,
          size: 10,
        })
      text('Signed revision integrity digest (SHA-256):', {
        size: 10,
        color: muted,
      })
      text(signature.integrityDigest, { font: mono, size: 9 })
    }
  } else {
    text('Immutable signature evidence is unavailable in this document.', {
      size: 10,
      color: muted,
    })
  }
  if (doc.integrityDigest) {
    text('Revision integrity digest (SHA-256):', { size: 10, color: muted })
    text(doc.integrityDigest, { font: mono, size: 9 })
  }
  if (doc.verificationCode) {
    text(
      `Verification code ${doc.verificationCode} is a short form of the integrity digest above. ` +
        "Check it against the CDMO's audit trail.",
      { size: 10 },
    )
  } else {
    text(
      'This document has no signed revision, so it has no verification code.',
      { size: 10, color: muted },
    )
  }

  pdf.setModificationDate(new Date(0))
  return await pdf.save()
}
