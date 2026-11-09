import { describe, expect, it } from 'vitest'

import { readZip } from '../eln/zip-read'
import { licenseById } from './licenses'
import { buildDatasetCrate } from './ro-crate'
import type { DatasetCrateInput } from './ro-crate'

const input: DatasetCrateInput = {
  name: 'Growth curves',
  description: 'OD600',
  datasetId: '11111111-1111-4111-8111-111111111111',
  datasetDisplayId: 'DS-0001',
  versionId: '22222222-2222-4222-8222-222222222222',
  versionLabel: 'v2',
  contentHash: 'abc123',
  exportedAt: '2026-11-07T10:00:00Z',
  fields: [
    {
      id: 'f1',
      key: 'strain',
      label: 'Strain',
      logicalType: 'text',
      nullable: false,
      unit: null,
    },
    {
      id: 'f2',
      key: 'od',
      label: 'OD600',
      logicalType: 'decimal',
      nullable: true,
      unit: 'AU',
    },
  ],
  rows: [
    { rowId: 'r1', revision: 1, values: { f1: 'K-12', f2: 0.42 } },
    { rowId: 'r2', revision: 1, values: { f1: 'BL21', f2: 0.51 } },
  ],
  terms: {
    strain: [
      {
        iri: 'http://purl.obolibrary.org/obo/NCBITaxon_562',
        label: 'Escherichia coli',
        ontology: 'ncbitaxon',
      },
    ],
  },
  authors: [{ name: 'Ada Lovelace' }],
  license: licenseById('cc-by-4.0'),
  doi: null,
  run: null,
}

function metadata(bytes: Uint8Array) {
  const files = readZip(bytes)

  const key = [...files.keys()].find((k) =>
    k.endsWith('ro-crate-metadata.json'),
  )!

  return {
    files,
    names: [...files.keys()],
    graph: JSON.parse(new TextDecoder().decode(files.get(key)))[
      '@graph'
    ] as Array<Record<string, unknown>>,
  }
}

describe('dataset crate', () => {
  it('holds the data, the licence, the authors and the ontology terms', async () => {
    const built = await buildDatasetCrate(input)
    expect(built.includesRunCrate).toBe(false)
    const { names, graph, files } = metadata(built.bytes)
    expect(names.some((n) => n.endsWith('.csv'))).toBe(true)

    const csv = new TextDecoder().decode(
      files.get(names.find((n) => n.endsWith('.csv'))!),
    )

    expect(csv).toContain('K-12')
    expect(JSON.stringify(graph)).toContain('NCBITaxon_562')
    expect(JSON.stringify(graph)).toContain('Ada Lovelace')
    expect(JSON.stringify(graph)).toContain(
      'creativecommons.org/licenses/by/4.0',
    )
  })

  it('adds a Workflow Run Crate when a pipeline run produced the version', async () => {
    const built = await buildDatasetCrate({
      ...input,
      run: {
        id: '33333333-3333-4333-8333-333333333333',
        status: 'succeeded',
        triggerKind: 'manual',
        startedAt: '2026-11-07T09:00:00Z',
        finishedAt: '2026-11-07T09:05:00Z',
        actorName: 'Ada Lovelace',
        parameters: { threshold: 0.5 },
        inputVersions: {},
        inputDigest: null,
        pipeline: {
          key: 'growth',
          name: 'Growth fit',
          version: 3,
          configuration: {},
        },
        manifestDigest: null,
      },
    })

    expect(built.includesRunCrate).toBe(true)
    const text = JSON.stringify(metadata(built.bytes).graph)
    expect(text).toContain('https://w3id.org/ro/wfrun/workflow/0.5')
    expect(text).toContain('CreateAction')
  })

  it('is deterministic', async () => {
    const a = await buildDatasetCrate(input)
    const b = await buildDatasetCrate(input)
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true)
  })
})
