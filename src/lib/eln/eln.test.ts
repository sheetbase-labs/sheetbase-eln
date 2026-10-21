import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { ZipWriter } from '../export/zip'
import { buildElnArchive } from './eln-archive'
import type { ElnArchiveInput, ElnExperiment } from './eln-archive'
import { ElnImportError, parseElnArchive } from './eln-import'
import { isSafeEntryName, readZip, ZipReadError } from './zip-read'

const text = (value: string) => new TextEncoder().encode(value)
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

const doc = (line: string) => ({
  doc: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: line }] }],
  },
})

function experiment(overrides: Partial<ElnExperiment> = {}): ElnExperiment {
  return {
    record: {
      id: 'rec-1',
      identifier: 'EXP-001',
      title: 'Titration / run 1',
      kind: 'experiment',
      status: 'signed',
      tags: ['hplc', 'qc'],
      createdAt: '2026-10-01T09:00:00.000Z',
    },
    blocks: [
      {
        id: 'b1',
        type: 'rich_text',
        order: 1,
        payloadSchemaVersion: 1,
        payload: doc('Added buffer.'),
      },
      {
        id: 'b2',
        type: 'file',
        order: 2,
        payloadSchemaVersion: 1,
        payload: { fileRecordId: 'f1' },
      },
    ],
    files: [
      {
        fileRecordId: 'f1',
        fileIdentifier: 'FIL-001',
        displayName: 'trace.csv',
        mediaType: 'text/csv',
        bytes: text('t,v\n0,1\n'),
      },
      {
        fileRecordId: 'f2',
        fileIdentifier: 'FIL-002',
        displayName: 'lost.pdf',
        mediaType: 'application/pdf',
        bytes: null,
        missingReason: 'missing',
      },
    ],
    datasets: [
      {
        id: 'ds-1',
        displayId: 'DS-0001',
        name: 'Plate read',
        description: null,
        csv: 'well,od\nA1,0.4\n',
      },
    ],
    signatures: [
      {
        id: 'sig-1',
        revisionId: 'rev-1',
        signerUserId: 'u1',
        signerName: 'Ada Lovelace',
        signerRole: 'scientist',
        signatureMeaning: 'approve-for-record',
        authMethod: 'password',
        revisionIntegrityDigest: 'a'.repeat(64),
        signedAt: '2026-10-02T10:00:00.000Z',
      },
    ],
    auditCsv: 'sequence,operation\n1,insert\n',
    ...overrides,
  }
}

const input = (experiments = [experiment()]): ElnArchiveInput => ({
  name: 'Project Alpha',
  project: { id: 'p1', key: 'ALPHA', title: 'Project Alpha', status: 'active' },
  workspaceId: 'ws',
  exportedAt: '2026-10-21T00:00:00.000Z',
  experiments,
})

describe('buildElnArchive', () => {
  it('writes one top-level folder with an RO-Crate descriptor and parts', async () => {
    const { bytes, missingFiles } = await buildElnArchive(input())
    const entries = readZip(bytes)
    const names = [...entries.keys()]
    expect(names.every((n) => n.startsWith('Project Alpha/'))).toBe(true)
    expect(names).toContain('Project Alpha/ro-crate-metadata.json')
    expect(names).toContain(
      'Project Alpha/EXP-001 Titration - run 1/files/trace.csv',
    )
    expect(names).toContain(
      'Project Alpha/EXP-001 Titration - run 1/datasets/DS-0001.csv',
    )
    expect(names).toContain(
      'Project Alpha/EXP-001 Titration - run 1/signatures.json',
    )
    expect(missingFiles).toEqual([
      { experiment: 'EXP-001', name: 'lost.pdf', reason: 'missing' },
    ])

    const crate = JSON.parse(
      decode(entries.get('Project Alpha/ro-crate-metadata.json')!),
    )
    const graph = crate['@graph'] as Array<Record<string, unknown>>
    const byId = new Map(graph.map((e) => [e['@id'] as string, e]))
    expect(byId.get('ro-crate-metadata.json')?.conformsTo).toEqual({
      '@id': 'https://w3id.org/ro/crate/1.1',
    })
    const root = byId.get('./')!
    expect(root.datePublished).toBe('2026-10-21T00:00:00.000Z')
    expect(root.hasPart).toEqual([{ '@id': './EXP-001 Titration - run 1/' }])
    const exp = byId.get('./EXP-001 Titration - run 1/')!
    expect(exp['@type']).toBe('Dataset')
    expect(exp.text).toBe('Added buffer.')
    expect(exp.keywords).toBe('hplc, qc')

    const file = byId.get('./EXP-001 Titration - run 1/files/trace.csv')!
    expect(file['@type']).toBe('File')
    expect(file.encodingFormat).toBe('text/csv')
    expect(exp.hasPart).toContainEqual({
      '@id': './EXP-001 Titration - run 1/files/trace.csv',
    })
  })

  it('records file checksums and signature metadata', async () => {
    const { bytes } = await buildElnArchive(input())
    const entries = readZip(bytes)
    const crate = JSON.parse(
      decode(entries.get('Project Alpha/ro-crate-metadata.json')!),
    )
    const graph = crate['@graph'] as Array<Record<string, unknown>>
    const sha = createHash('sha256').update('t,v\n0,1\n').digest('hex')
    const byName = graph.find((e) => e.sha256 === sha)
    expect(byName?.contentSize).toBe('8')
    const signature = graph.find((e) => e['@id'] === '#signature-sig-1')!
    expect(signature['@type']).toEqual(['Action', 'sheetbase:Signature'])
    expect(signature['sheetbase:revisionIntegrityDigest']).toBe('a'.repeat(64))
    expect(graph.some((e) => e['@id'] === '#person-u1')).toBe(true)
  })

  it('is deterministic', async () => {
    const a = await buildElnArchive(input())
    const b = await buildElnArchive(input())
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true)
  })

  it('disambiguates duplicate file names', async () => {
    const dup = experiment()
    dup.files = [
      { ...dup.files[0] },
      { ...dup.files[0], fileRecordId: 'f3', fileIdentifier: 'FIL-003' },
    ]
    const { bytes } = await buildElnArchive(input([dup]))
    const names = [...readZip(bytes).keys()]
    expect(names.filter((n) => n.includes('/files/'))).toEqual([
      'Project Alpha/EXP-001 Titration - run 1/files/trace.csv',
      'Project Alpha/EXP-001 Titration - run 1/files/trace-2.csv',
    ])
  })

  it('neutralises hostile names', async () => {
    const hostile = experiment()
    hostile.files = [{ ...hostile.files[0], displayName: '../../etc/passwd' }]
    const { bytes } = await buildElnArchive(input([hostile]))
    for (const name of readZip(bytes).keys()) {
      expect(isSafeEntryName(name)).toBe(true)
    }
  })
})

describe('parseElnArchive', () => {
  it('round-trips Sheetbase text blocks and tags', async () => {
    const { bytes } = await buildElnArchive(input())
    const plan = parseElnArchive(bytes)
    expect(plan.experiments).toHaveLength(1)
    const [exp] = plan.experiments
    expect(exp.title).toBe('Titration / run 1')
    expect(exp.tags).toEqual(['hplc', 'qc'])
    expect(exp.source).toBe('sheetbase')
    expect(exp.sourceIdentifier).toBe('EXP-001')
    expect(exp.blocks).toHaveLength(1)
    expect(exp.blocks[0].payload).toEqual(doc('Added buffer.'))
    expect(plan.warnings.join(' ')).toContain('non-text block')
    expect(plan.warnings.join(' ')).toContain('attached file')
  })

  it('imports a foreign RO-Crate experiment as text', () => {
    const writer = new ZipWriter()
    writer.add(
      'crate/ro-crate-metadata.json',
      JSON.stringify({
        '@context': 'https://w3id.org/ro/crate/1.1/context',
        '@graph': [
          { '@id': 'ro-crate-metadata.json', '@type': 'CreativeWork' },
          { '@id': './', '@type': 'Dataset', hasPart: [{ '@id': './a/' }] },
          {
            '@id': './a/',
            '@type': 'Dataset',
            name: 'Foreign entry',
            text: 'line one\nline two',
            keywords: 'x, y',
          },
        ],
      }),
    )
    return writer.stream().then((bytes) => {
      const plan = parseElnArchive(bytes)
      expect(plan.experiments[0].title).toBe('Foreign entry')
      expect(plan.experiments[0].source).toBe('ro-crate')
      expect(plan.experiments[0].tags).toEqual(['x', 'y'])
      expect(plan.experiments[0].blocks[0].payload).toEqual({
        doc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'line one' }],
            },
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'line two' }],
            },
          ],
        },
      })
    })
  })

  it('rejects archives that are not .eln', async () => {
    const writer = new ZipWriter()
    writer.add('hello.txt', 'hi')
    expect(() => parseElnArchive(new Uint8Array([1, 2, 3]))).toThrow(
      ElnImportError,
    )
    const plain = Buffer.from(await writer.stream())
    expect(() => parseElnArchive(plain)).toThrow(/ro-crate-metadata/)
  })
})

describe('readZip', () => {
  it('refuses path traversal entries', async () => {
    const writer = new ZipWriter()
    writer.add('../evil.txt', 'x')
    const evil = Buffer.from(await writer.stream())
    expect(() => readZip(evil)).toThrow(ZipReadError)
  })

  it('enforces the unpacked size limit', async () => {
    const writer = new ZipWriter()
    writer.add('big.txt', 'a'.repeat(1000))
    const bytes = await writer.stream()
    expect(() =>
      readZip(bytes, { maxEntries: 10, maxUncompressedBytes: 100 }),
    ).toThrow(/too large/)
  })
})
