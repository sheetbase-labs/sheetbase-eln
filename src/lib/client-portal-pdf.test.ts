import { describe, expect, it } from 'vitest'

import { formatPortalDate } from './client-portal'
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
})
