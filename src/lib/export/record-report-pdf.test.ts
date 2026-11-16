import { extractText, getDocumentProxy } from 'unpdf'
import { describe, expect, it } from 'vitest'

import { renderRecordReportPdf, reportDateTime } from './record-report-pdf'
import type { ReportInput } from './record-report-pdf'

const heading = (text: string) => ({
  type: 'heading',
  attrs: { level: 2 },
  content: [{ type: 'text', text }],
})

const input: ReportInput = {
  identifier: 'EXP-0142',
  title: 'Depth filter screen',
  kind: 'experiment',
  recordStatus: 'approved',
  revisionId: 'rev-1',
  reason: 'submit',
  capturedAt: '2026-11-16T22:14:00Z',
  structureVersion: '2',
  integrityDigest:
    'c4e7533c6e191bf191072bb9bb947e393027395459b75966c172ff23f42ba941',
  verificationCode: 'C4E7-533C-6E19',
  signatures: [
    {
      signerName: 'Mei L.',
      signedAt: '2026-11-16T22:16:22Z',
      meaning: 'reviewed-and-approved',
      authMethod: 'password',
    },
  ],
  blockSnapshot: [
    {
      id: 'b1',
      type: 'rich_text',
      order: 1,
      payload: { doc: { content: [heading('Objective')] } },
    },
    {
      id: 'b2',
      type: 'table',
      order: 2,
      payload: { columns: ['Load', 'Titre'], rows: [[50, 730000000000]] },
    },
    {
      id: 'b3',
      type: 'conclusion',
      order: 3,
      payload: {
        verdict: 'supported',
        text: 'Train B is selected.',
        basis: 'Figure 1',
      },
    },
  ],
  sheetEvidence: [],
  files: [],
}

async function textOf(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes))
  const { text } = await extractText(pdf, { mergePages: true })

  return text
}

describe('renderRecordReportPdf', () => {
  it('puts who signed, when and for what on the first page, with the notebook after', async () => {
    const text = await textOf(await renderRecordReportPdf(input))

    expect(text).toContain('Approved and signed')
    expect(text).toContain('Mei L.')
    expect(text).toContain('Reviewed and approved')
    expect(text).toContain('16 Nov 2026, 22:16 UTC')
    expect(text).toContain('C4E7-533C-6E19')
    expect(text).toContain('Objective')
    expect(text).toContain('Conclusion: Supported')
  })

  it('writes a large number the way the live sheet does', async () => {
    const text = await textOf(await renderRecordReportPdf(input))

    expect(text).toContain('7.3 × 10')
    expect(text).not.toContain('730000000000')
  })

  it('says so when nobody has signed', async () => {
    const text = await textOf(
      await renderRecordReportPdf({
        ...input,
        signatures: [],
        verificationCode: null,
      }),
    )

    expect(text).toContain('Submitted record, not signed')
    expect(text).toContain('No one has signed this revision yet.')
  })
})

describe('reportDateTime', () => {
  it('reads the same wherever it is opened', () => {
    expect(reportDateTime('2026-09-21T13:10:00Z')).toBe(
      '21 Sep 2026, 13:10 UTC',
    )
    expect(reportDateTime(null)).toBe('—')
  })
})
