import { afterEach, describe, expect, it } from 'vitest'
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib'

import { formatPortalDate, formatPortalDay } from './client-portal'
import { setDisplayTimeZone } from './display-time-zone'
import type { ClientPortalRecordDocument } from './client-portal'
import {
  blockSnapshotLines,
  renderClientPortalRecordPdf,
} from './client-portal-pdf'

const recordDocument: ClientPortalRecordDocument = {
  recordId: '00000000-0000-4000-8000-000000000352',
  identifier: 'EXP-0136',
  title: 'Seeding density at transfection',
  kind: 'experiment',
  projectTitle: 'AAV9 process transfer',
  approvedAt: '2026-09-19T09:00:00.000Z',
  approvedByName: 'Mei L.',
  signatureMeaning: 'approve-for-record',
  integrityDigest: 'ab'.repeat(32),
  verificationCode: 'ABAB-ABAB',
  revisionStructureVersion: 1,
  blockSnapshot: [
    {
      type: 'rich_text',
      payload: {
        doc: {
          type: 'doc',
          content: [
            {
              type: 'heading',
              content: [{ type: 'text', text: 'Objective' }],
            },
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'Compare 1.5, 2.0 and 2.5 × 10⁶ cells/mL.',
                },
              ],
            },
          ],
        },
      },
    },
  ],
  reportSections: [],
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await PDFDocument.load(bytes)
  const lines: string[] = []
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue
    const commands = new TextDecoder().decode(
      decodePDFRawStream(object).decode(),
    )
    for (const match of commands.matchAll(/<([\dA-Fa-f]+)>\s*Tj/g)) {
      lines.push(Buffer.from(match[1], 'hex').toString('latin1'))
    }
  }
  return lines.join('\n')
}

describe('client portal record PDF', () => {
  it('extracts one line per frozen document node', () => {
    expect(blockSnapshotLines(recordDocument.blockSnapshot)).toEqual([
      'Objective',
      'Compare 1.5, 2.0 and 2.5 × 10⁶ cells/mL.',
    ])
  })

  it('ignores blocks without a rich-text document', () => {
    expect(
      blockSnapshotLines([{ type: 'file', payload: { fileId: 'f1' } }]),
    ).toEqual([])
  })

  it('renders a signed approved record to a PDF', async () => {
    const bytes = await renderClientPortalRecordPdf(recordDocument)
    const header = new TextDecoder().decode(bytes.slice(0, 5))
    expect(header).toBe('%PDF-')
    expect(bytes.byteLength).toBeGreaterThan(500)
  })

  it('prints every immutable signature with exact evidence, never a current profile fallback', async () => {
    const signatures = [
      {
        id: 'signature-historical-1',
        revisionId: 'frozen-revision-7',
        signerName: null,
        signedAt: '2026-09-19T09:03:14.123456+00:00',
        signatureMeaning: 'approve-for-record' as const,
        integrityDigest: 'ab'.repeat(32),
      },
      {
        id: 'signature-witness-2',
        revisionId: 'frozen-revision-7',
        signerName: 'Stored Witness Name',
        signedAt: '2026-09-19T10:17:55.987654+00:00',
        signatureMeaning: 'witnessed' as const,
        integrityDigest: 'cd'.repeat(32),
      },
    ]
    const text = await pdfText(
      await renderClientPortalRecordPdf({
        ...recordDocument,
        approvedByName: 'Renamed Current Profile',
        signatures,
      }),
    )
    expect(text).toContain('Compare 1.5, 2.0 and 2.5 × 10^6 cells/mL.')
    expect(text).toContain('Signer name not recorded')
    for (const signature of signatures) {
      expect(text).toContain(signature.id)
      expect(text).toContain(signature.revisionId)
      expect(text).toContain(signature.signedAt)
      expect(text).toContain(signature.signatureMeaning)
      expect(text).toContain(signature.integrityDigest)
    }
    expect(text).toContain('Stored Witness Name')
    expect(text).not.toContain('Renamed Current Profile')
    expect(text).not.toContain('the CDMO team')
  })

  it('does not manufacture a signature from legacy summary fields without immutable evidence', async () => {
    const text = await pdfText(
      await renderClientPortalRecordPdf(recordDocument),
    )
    expect(text).toContain('Immutable signature evidence is unavailable')
    expect(text).not.toContain('Mei L.')
    expect(text).not.toContain('Meaning: approve-for-record')
  })

  it('renders frozen tables and composed Sheets with their submitted values and column order', async () => {
    const text = await pdfText(
      await renderClientPortalRecordPdf({
        ...recordDocument,
        scientificTables: [
          {
            name: 'Submitted assay',
            columns: [
              { field_name: 'viability', label: 'Viability' },
              { field_name: 'titre', label: 'Titre' },
            ],
            rows: [
              { titre: 17, viability: 83 },
              { titre: 29, viability: 71 },
            ],
          },
        ],
        sheetEvidence: [
          {
            blockId: 'submitted-sheet-block',
            instanceId: 'submitted-instance',
            instanceRevision: 4,
            instanceState: {
              localValues: {
                live: { field1: 'Do not use reconstructed live values' },
              },
            },
            composedGrid: {
              columns: [
                { id: 'field1', label: 'Sample' },
                { id: 'field2', label: 'Yield' },
              ],
              rows: [
                ['Lot A', 3.7],
                ['Lot B', 9.2],
              ],
            },
          },
        ],
      }),
    )
    expect(text).toContain('Frozen table: Submitted assay')
    expect(text).toContain('Viability: 83 | Titre: 17')
    expect(text).toContain('Viability: 71 | Titre: 29')
    expect(text).toContain('Frozen Sheet: submitted-sheet-block')
    expect(text).toContain('Instance revision: 4')
    expect(text).toContain('Sample: Lot A | Yield: 3.7')
    expect(text).toContain('Sample: Lot B | Yield: 9.2')
    expect(text).not.toContain('Do not use reconstructed live values')
  })

  it('renders a report with sections and no signature', async () => {
    const bytes = await renderClientPortalRecordPdf({
      ...recordDocument,
      recordId: 'rpt',
      identifier: 'RPT-2026-0001',
      kind: 'report',
      approvedAt: null,
      approvedByName: null,
      signatureMeaning: null,
      integrityDigest: null,
      verificationCode: null,
      revisionStructureVersion: null,
      blockSnapshot: [],
      reportSections: [
        {
          title: 'Genome titre by PEI:DNA ratio',
          description: null,
          payload: { note: 'Titre held across the sweep.' },
        },
      ],
    })
    const header = new TextDecoder().decode(bytes.slice(0, 5))
    expect(header).toBe('%PDF-')
  })
})

describe('portal date formatting', () => {
  const now = new Date('2026-09-25T09:40:00+01:00')
  it('labels the same calendar day as Today', () => {
    expect(formatPortalDate('2026-09-25T08:40:00.000Z', now)).toBe('Today')
  })
  it('labels other days with a short date', () => {
    expect(formatPortalDate('2026-09-20T08:00:00.000Z', now)).toBe('20 Sep')
  })
  it('renders a dash for a missing date', () => {
    expect(formatPortalDate(null, now)).toBe('—')
  })

  describe("on the workspace's clock, not the viewer's", () => {
    afterEach(() => setDisplayTimeZone(undefined))

    it('names the day the lab means for a milestone late in the evening', () => {
      // 23:30 on the 24th in London is already the 25th in Sydney, and 00:30
      // on the 25th in London is still the 24th in Los Angeles.
      setDisplayTimeZone('Europe/London')
      expect(formatPortalDay('2026-09-24T22:30:00.000Z')).toBe('24 Sep')
      setDisplayTimeZone('Australia/Sydney')
      expect(formatPortalDay('2026-09-24T22:30:00.000Z')).toBe('25 Sep')
      setDisplayTimeZone('America/Los_Angeles')
      expect(formatPortalDay('2026-09-25T07:30:00.000Z')).toBe('25 Sep')
      expect(formatPortalDay('2026-09-25T06:30:00.000Z')).toBe('24 Sep')
    })

    it('decides Today by the same clock', () => {
      setDisplayTimeZone('Australia/Sydney')
      // 22:30 UTC on the 24th is 08:30 on the 25th in Sydney, "now" is the 25th.
      expect(
        formatPortalDate(
          '2026-09-24T22:30:00.000Z',
          new Date('2026-09-25T02:00:00Z'),
        ),
      ).toBe('Today')
    })
  })
})
