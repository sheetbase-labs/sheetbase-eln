import { describe, expect, it } from 'vitest'

import {
  renderRevisionPdf,
  revisionPackageToDocument,
  verificationCodeFor,
} from './revision-pdf'
import type { RevisionPdfPackage } from './revision-pdf'

const pkg: RevisionPdfPackage = {
  revision: {
    id: 'rev-1',
    structureVersion: '3',
    integrityDigest: 'ab12cd34ef56ab12cd34ef56',
  },
  record: {
    identifier: 'EXP-0142',
    title: 'Plate reader run',
    kind: 'experiment',
    status: 'approved',
  },
  blockSnapshot: [
    {
      payload: {
        doc: {
          content: [{ content: [{ text: 'Frozen paragraph of the run.' }] }],
        },
      },
    },
  ],
  signatures: [
    {
      id: 'sig-1',
      revision_id: 'rev-1',
      signed_at: '2026-09-01T10:00:00Z',
      signature_meaning: 'reviewed-and-approved',
      revision_integrity_digest: 'ab12cd34ef56ab12cd34ef56',
      signer_name: 'Ada Lovelace',
    },
  ],
}

describe('revisionPackageToDocument', () => {
  it('maps the evidence package to the document the renderer draws', () => {
    const doc = revisionPackageToDocument(pkg)
    expect(doc.identifier).toBe('EXP-0142')
    expect(doc.revisionStructureVersion).toBe(3)
    expect(doc.approvedByName).toBe('Ada Lovelace')
    expect(doc.verificationCode).toBe('AB12-CD34-EF56')
    expect(doc.signatures?.[0]).toMatchObject({
      id: 'sig-1',
      signerName: 'Ada Lovelace',
      signatureMeaning: 'reviewed-and-approved',
    })
  })

  it('keeps an unsigned revision honest: no approver, no code', () => {
    const doc = revisionPackageToDocument({
      ...pkg,
      signatures: [],
      revision: { ...pkg.revision, integrityDigest: null },
    })
    expect(doc.approvedByName).toBeNull()
    expect(doc.verificationCode).toBeNull()
    expect(doc.signatures).toEqual([])
  })
})

describe('verificationCodeFor', () => {
  it('needs a digest long enough to quote', () => {
    expect(verificationCodeFor(null)).toBeNull()
    expect(verificationCodeFor('abc')).toBeNull()
  })
})

describe('renderRevisionPdf', () => {
  it('renders a PDF document', async () => {
    const bytes = await renderRevisionPdf(pkg)
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
  })
})
