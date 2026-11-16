// @vitest-environment node
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { buildEvidencePackage, parseEvidencePackage } from './evidence-package'

describe('evidence package input', () => {
  it('keeps scientific extension keys and grid rendering intact', async () => {
    const evidence = {
      extension: { instrument: 'reader', readings: [2.5, 4.1] },
      revision: {
        workspaceId: 'workspace',
        id: 'revision',
        reason: 'submit',
        structureVersion: 1,
        metadataVersion: 2,
        integrityAlgorithm: 'sha256',
        integrityDigest: 'digest',
        supersededByRevisionId: null,
        extraScientificKey: { units: 'mg/mL' },
      },
      record: { identifier: 'EXP-1', title: null, kind: null, status: null },
      blockSnapshot: [{ payload: { calibration: 'v2' } }],
      sheetEvidence: [
        {
          blockId: 'grid',
          composedGrid: {
            columns: [{ id: 'concentration', label: 'Concentration' }],
            rows: [[{ value: 2.5, unit: 'mg/mL' }]],
            extension: 'do not discard',
          },
        },
      ],
      files: [],
      signatures: [],
    }

    const files = unzipSync(await buildEvidencePackage(evidence))

    expect(strFromU8(files['evidence.json'])).toBe(
      JSON.stringify(evidence, null, 2),
    )
    expect(strFromU8(files['grids/grid.csv'])).toBe(
      '"Concentration"\r\n"{""value"":2.5,""unit"":""mg/mL""}"\r\n',
    )
  })

  it('has a README that says who signed, not only the record status at export', async () => {
    const evidence = {
      revision: {
        workspaceId: 'workspace',
        id: 'revision',
        reason: 'submit',
        structureVersion: 1,
        metadataVersion: 2,
        integrityAlgorithm: 'sha256',
        integrityDigest: 'digest',
        supersededByRevisionId: null,
      },
      record: {
        identifier: 'EXP-1',
        title: 'T',
        kind: 'experiment',
        status: 'in_progress',
      },
      blockSnapshot: [],
      sheetEvidence: [],
      files: [],
      signatures: [
        {
          signer_name: 'Mei L.',
          signed_at: '2026-11-16T22:16:22Z',
          signature_meaning: 'reviewed-and-approved',
        },
      ],
    }

    const readme = strFromU8(
      unzipSync(await buildEvidencePackage(evidence))['README.md'],
    )

    expect(readme).toContain(
      'Signed by Mei L. on 2026-11-16T22:16:22Z (reviewed-and-approved)',
    )
    expect(readme).toContain('Record status when exported: in_progress')
    expect(readme).not.toContain('Kind/status')
  })

  it('rejects malformed structure at the evidence ingress', () => {
    expect(() => parseEvidencePackage({ revision: null })).toThrow()
  })

  it('does not read extension getters before serializing evidence', async () => {
    let reads = 0
    let reasonReads = 0

    const evidence = {
      get extension() {
        reads += 1

        return { units: 'mg/mL' }
      },
      revision: {
        id: 'r',
        workspaceId: 'w',
        get reason() {
          reasonReads += 1

          return `submit-${reasonReads}`
        },
        structureVersion: 1,
        metadataVersion: 1,
        integrityAlgorithm: null,
        integrityDigest: null,
        supersededByRevisionId: null,
      },
      record: null,
      blockSnapshot: [],
      sheetEvidence: [],
      files: [],
      signatures: [],
    }

    const files = unzipSync(await buildEvidencePackage(evidence))

    expect(reads).toBe(1)
    expect(reasonReads).toBe(2)
    expect(JSON.parse(strFromU8(files['evidence.json'])).revision.reason).toBe(
      'submit-1',
    )
    expect(JSON.parse(strFromU8(files['evidence.json'])).extension).toEqual({
      units: 'mg/mL',
    })
  })

  it('retains native values and getter order in composed and local grids', async () => {
    await Promise.all(
      [false, true].map(async (fallback) => {
        const reads: string[] = []

        class Field {
          get fieldId() {
            reads.push('fieldId')

            return 'value'
          }

          get id() {
            reads.push('id')

            return 'value'
          }

          get label() {
            reads.push('label')

            return 'Result'
          }
        }

        class Measurement {
          toJSON() {
            return { concentration: 2.5, unit: 'mg/mL' }
          }
        }

        const field = new Field()
        const value = new Measurement()

        const evidence = {
          revision: {
            id: 'r',
            workspaceId: 'w',
            reason: 'submit',
            structureVersion: 1,
            metadataVersion: 1,
            integrityAlgorithm: null,
            integrityDigest: null,
            supersededByRevisionId: null,
          },
          record: null,
          blockSnapshot: [],
          files: [],
          signatures: [],
          sheetEvidence: [
            {
              blockId: 'b',
              composedGrid: fallback
                ? null
                : { columns: [field], rows: [[value, Symbol.for('native')]] },
              instanceState: fallback
                ? { localFields: [field], localValues: [{ value }] }
                : null,
            },
          ],
        }

        const files = unzipSync(await buildEvidencePackage(evidence))
        const suffix = fallback ? '' : ',"Symbol(native)"'

        expect(strFromU8(files['grids/b.csv'])).toBe(
          `"Result"\r\n"{""concentration"":2.5,""unit"":""mg/mL""}"${suffix}\r\n`,
        )
        expect(reads).toEqual(
          fallback
            ? ['fieldId', 'label', 'label', 'fieldId']
            : ['id', 'label', 'label', 'label'],
        )
      }),
    )
  })
})
