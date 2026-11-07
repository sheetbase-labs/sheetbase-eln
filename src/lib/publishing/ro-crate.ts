/**
 * RO-Crate packages for publishing a dataset version.
 *
 * The package is an RO-Crate 1.1: the data as CSV, a description of every
 * column (with its unit and ontology terms), the licence and the authors.
 * When a pipeline run produced the version it also carries a Workflow Run
 * Crate (https://www.researchobject.org/workflow-run-crate/): the pipeline as
 * the workflow, the run as a CreateAction with its parameters, the input
 * dataset versions and the output, so someone else can see exactly how the
 * numbers were made.
 *
 * Pure and deterministic: bytes derive from the input alone.
 */
import { createHash } from 'node:crypto'

import { delimitedHeaderLine, delimitedRowLine } from '../export/delimited'
import type { ExportField, ExportRow } from '../export/delimited'
import { ZipWriter } from '../export/zip'
import { safeName } from '../eln/eln-archive'
import type { PublicationLicense } from './licenses'

export interface CrateOntologyTerm {
  iri: string
  label: string
  ontology: string
}

export interface CrateRun {
  id: string
  status: string
  triggerKind: string
  startedAt: string
  finishedAt: string | null
  actorName: string | null
  parameters: unknown
  inputVersions: unknown
  inputDigest: string | null
  pipeline: {
    key: string
    name: string
    version: number
    configuration: unknown
  }
  /** The signed manifest of the run, when one was kept. */
  manifestDigest: string | null
}

export interface DatasetCrateInput {
  name: string
  description: string | null
  datasetId: string
  datasetDisplayId: string | null
  versionId: string
  versionLabel: string
  contentHash: string | null
  exportedAt: string
  fields: ExportField[]
  rows: ExportRow[]
  /** Ontology terms by field key. */
  terms: Record<string, CrateOntologyTerm[]>
  authors: Array<{ name: string }>
  license: PublicationLicense
  doi: string | null
  run: CrateRun | null
}

type Json = Record<string, unknown>

const sha256 = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex')

const PROCESS_PROFILE = 'https://w3id.org/ro/wfrun/process/0.5'
const WORKFLOW_PROFILE = 'https://w3id.org/ro/wfrun/workflow/0.5'
const PROVENANCE_PROFILE = 'https://w3id.org/ro/wfrun/provenance/0.5'

const DATA_TYPE: Record<string, string> = {
  integer: 'Integer',
  decimal: 'Number',
  boolean: 'Boolean',
  date: 'Date',
  timestamp: 'DateTime',
}

export interface BuiltCrate {
  bytes: Uint8Array
  includesRunCrate: boolean
  fileName: string
}

export async function buildDatasetCrate(
  input: DatasetCrateInput,
): Promise<BuiltCrate> {
  const base = safeName(
    `${input.datasetDisplayId ?? 'dataset'} ${input.versionLabel}`,
    'dataset',
  )
  const writer = new ZipWriter()
  const add = (path: string, content: string | Uint8Array) =>
    writer.add(`${base}/${path}`, content)

  const csv =
    delimitedHeaderLine(input.fields, ',') +
    '\r\n' +
    input.rows
      .map((row) => delimitedRowLine(input.fields, row, ','))
      .join('\r\n') +
    (input.rows.length > 0 ? '\r\n' : '')
  const csvBytes = new TextEncoder().encode(csv)
  const csvPath = `data/${base}.csv`
  add(csvPath, csvBytes)

  const graph: Json[] = []
  const rootParts: Json[] = [{ '@id': csvPath }]

  // The table and its columns.
  const columns = input.fields.map((field) => {
    const terms = input.terms[field.key] ?? []
    return {
      '@id': `#column-${field.key}`,
      '@type': 'PropertyValue',
      name: field.label,
      alternateName: field.key,
      valueType: DATA_TYPE[field.logicalType] ?? 'Text',
      unitText: field.unit ?? undefined,
      description: field.nullable ? undefined : 'Required',
      propertyID: terms.map((t) => t.iri),
      additionalProperty: terms.map((t) => ({
        '@type': 'PropertyValue',
        name: t.ontology,
        value: t.label,
        propertyID: t.iri,
      })),
    }
  })
  graph.push({
    '@id': csvPath,
    '@type': 'File',
    name: `${input.name} (${input.versionLabel})`,
    encodingFormat: 'text/csv',
    contentSize: String(csvBytes.length),
    sha256: sha256(csvBytes),
    variableMeasured: columns.map((c) => ({ '@id': c['@id'] })),
    'sheetbase:rowCount': input.rows.length,
  })
  graph.push(...columns)
  for (const term of Object.values(input.terms).flat()) {
    if (graph.some((e) => e['@id'] === term.iri)) continue
    graph.push({
      '@id': term.iri,
      '@type': 'DefinedTerm',
      name: term.label,
      inDefinedTermSet: term.ontology.toUpperCase(),
    })
  }

  // The licence and the authors.
  graph.push({
    '@id': input.license.url,
    '@type': 'CreativeWork',
    name: input.license.name,
    identifier: input.license.id,
  })
  input.authors.forEach((author, i) => {
    graph.push({
      '@id': `#author-${i + 1}`,
      '@type': 'Person',
      name: author.name,
    })
  })

  const conformsTo: Json[] = [{ '@id': 'https://w3id.org/ro/crate/1.1' }]
  let includesRunCrate = false

  if (input.run) {
    includesRunCrate = true
    conformsTo.push(
      { '@id': PROCESS_PROFILE },
      { '@id': WORKFLOW_PROFILE },
      { '@id': PROVENANCE_PROFILE },
    )
    const run = input.run
    const workflowPath = `workflow/${safeName(run.pipeline.key, 'pipeline')}-v${run.pipeline.version}.json`
    const workflowBytes = new TextEncoder().encode(
      JSON.stringify(
        {
          key: run.pipeline.key,
          name: run.pipeline.name,
          version: run.pipeline.version,
          configuration: run.pipeline.configuration,
        },
        null,
        2,
      ),
    )
    add(workflowPath, workflowBytes)
    const runPath = `workflow/run-${run.id}.json`
    const runBytes = new TextEncoder().encode(
      JSON.stringify(
        {
          id: run.id,
          status: run.status,
          trigger: run.triggerKind,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          parameters: run.parameters,
          inputVersions: run.inputVersions,
          inputDigest: run.inputDigest,
          manifestDigest: run.manifestDigest,
        },
        null,
        2,
      ),
    )
    add(runPath, runBytes)
    rootParts.push({ '@id': workflowPath }, { '@id': runPath })
    graph.push(
      {
        '@id': 'https://w3id.org/ro/wfrun/process/0.5',
        '@type': 'CreativeWork',
        name: 'Process Run Crate',
        version: '0.5',
      },
      {
        '@id': 'https://w3id.org/ro/wfrun/workflow/0.5',
        '@type': 'CreativeWork',
        name: 'Workflow Run Crate',
        version: '0.5',
      },
      {
        '@id': 'https://w3id.org/ro/wfrun/provenance/0.5',
        '@type': 'CreativeWork',
        name: 'Provenance Run Crate',
        version: '0.5',
      },
      {
        '@id': '#sheetbase-pipeline-language',
        '@type': 'ComputerLanguage',
        name: 'Sheetbase pipeline',
        identifier: { '@id': 'https://sheetbase.io/ns/pipeline#' },
        url: 'https://sheetbase.io/ns/pipeline#',
      },
      {
        '@id': workflowPath,
        '@type': ['File', 'SoftwareSourceCode', 'ComputationalWorkflow'],
        name: run.pipeline.name,
        version: String(run.pipeline.version),
        encodingFormat: 'application/json',
        programmingLanguage: { '@id': '#sheetbase-pipeline-language' },
        contentSize: String(workflowBytes.length),
        sha256: sha256(workflowBytes),
      },
      {
        '@id': runPath,
        '@type': 'File',
        name: 'Run record',
        encodingFormat: 'application/json',
        contentSize: String(runBytes.length),
        sha256: sha256(runBytes),
      },
      {
        '@id': '#sheetbase',
        '@type': 'SoftwareApplication',
        name: 'Sheetbase',
        url: 'https://sheetbase.io',
      },
    )
    if (run.actorName) {
      graph.push({
        '@id': '#run-agent',
        '@type': 'Person',
        name: run.actorName,
      })
    }
    // The run itself.
    const paramEntities: Json[] = []
    const asRecord = (v: unknown): Record<string, unknown> =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? (v as Record<string, unknown>)
        : {}
    for (const [key, value] of Object.entries(asRecord(run.parameters))) {
      const id = `#param-${safeName(key, 'p')}`
      paramEntities.push({
        '@id': id,
        '@type': 'PropertyValue',
        name: key,
        value: typeof value === 'object' ? JSON.stringify(value) : value,
      })
    }
    graph.push(...paramEntities)
    const inputs = Object.entries(asRecord(run.inputVersions)).map(
      ([key, value]) => {
        const id = `#input-${safeName(key, 'i')}`
        graph.push({
          '@id': id,
          '@type': 'PropertyValue',
          name: key,
          value:
            typeof value === 'object' ? JSON.stringify(value) : String(value),
        })
        return { '@id': id }
      },
    )
    graph.push({
      '@id': `#run-${run.id}`,
      '@type': 'CreateAction',
      name: `Run of ${run.pipeline.name}`,
      instrument: { '@id': workflowPath },
      object: [...paramEntities.map((p) => ({ '@id': p['@id'] })), ...inputs],
      result: [{ '@id': csvPath }],
      startTime: run.startedAt,
      endTime: run.finishedAt ?? undefined,
      actionStatus: {
        '@id':
          run.status === 'succeeded'
            ? 'http://schema.org/CompletedActionStatus'
            : 'http://schema.org/FailedActionStatus',
      },
      agent: run.actorName ? { '@id': '#run-agent' } : undefined,
      'sheetbase:inputDigest': run.inputDigest ?? undefined,
      'sheetbase:manifestDigest': run.manifestDigest ?? undefined,
      description: `Triggered ${run.triggerKind}`,
    })
    graph.push({
      '@id': '#sheetbase-run-engine',
      '@type': 'SoftwareApplication',
      name: 'Sheetbase pipeline engine',
      url: 'https://sheetbase.io',
    })
    const action = graph.find((e) => e['@id'] === `#run-${run.id}`)
    if (action)
      action.instrument = [
        { '@id': workflowPath },
        { '@id': '#sheetbase-run-engine' },
      ]
    // The workflow is the main entity of a Workflow Run Crate.
  }

  const root: Json = {
    '@id': './',
    '@type': 'Dataset',
    name: `${input.name} · ${input.versionLabel}`,
    description:
      input.description ??
      `Snapshot ${input.versionLabel} of the dataset ${input.name}.`,
    datePublished: input.exportedAt,
    identifier: input.doi
      ? [
          `https://doi.org/${input.doi}`,
          input.datasetDisplayId ?? input.datasetId,
        ]
      : (input.datasetDisplayId ?? input.datasetId),
    license: { '@id': input.license.url },
    author: input.authors.map((_, i) => ({ '@id': `#author-${i + 1}` })),
    hasPart: rootParts,
    mainEntity: input.run ? { '@id': rootParts[1]['@id'] } : undefined,
    additionalProperty: [
      {
        '@type': 'PropertyValue',
        name: 'datasetVersionId',
        value: input.versionId,
      },
      ...(input.contentHash
        ? [
            {
              '@type': 'PropertyValue',
              name: 'contentHash',
              value: input.contentHash,
            },
          ]
        : []),
    ],
  }
  const crate = {
    '@context': [
      'https://w3id.org/ro/crate/1.1/context',
      'https://w3id.org/ro/terms/workflow-run',
      { sheetbase: 'https://sheetbase.io/ns/eln#' },
    ],
    '@graph': [
      {
        '@id': 'ro-crate-metadata.json',
        '@type': 'CreativeWork',
        about: { '@id': './' },
        conformsTo,
        sdPublisher: { '@id': '#sheetbase' },
        dateCreated: input.exportedAt,
      },
      root,
      ...(includesRunCrate
        ? []
        : [
            {
              '@id': '#sheetbase',
              '@type': 'Organization',
              name: 'Sheetbase',
              url: 'https://sheetbase.io',
            },
          ]),
      ...graph,
    ],
  }
  add('ro-crate-metadata.json', JSON.stringify(crate, null, 2))
  return {
    bytes: await writer.stream(),
    includesRunCrate,
    fileName: `${base}.ro-crate.zip`,
  }
}
