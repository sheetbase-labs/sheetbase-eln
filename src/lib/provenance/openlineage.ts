/**
 * OpenLineage RunEvents for the things a lab runs: pipeline runs, imports,
 * instrument runs, plate runs and worklists. Pure: the sweep reads the rows and
 * this shapes them. Dataset versions are the inputs and outputs; where a
 * pipeline's output columns match input columns by name, a column lineage facet
 * says so.
 */

export const OPENLINEAGE_SCHEMA_URL =
  'https://openlineage.io/spec/2-0-2/OpenLineage.json#/$defs/RunEvent'

export type LineageEventType = 'START' | 'COMPLETE' | 'FAIL' | 'ABORT'

export interface LineageDatasetRef {
  datasetId: string
  name: string
  versionId?: string | null
  /** Column names, for the schema facet and column lineage. */
  columns?: string[]
}

export interface LineageActivity {
  eventType: LineageEventType
  eventTime: string
  runId: string
  jobName: string
  jobType: 'PIPELINE' | 'IMPORT' | 'INSTRUMENT' | 'PLATE' | 'WORKLIST'
  inputs: LineageDatasetRef[]
  outputs: LineageDatasetRef[]
  errorMessage?: string | null
}

export interface OpenLineageDataset {
  namespace: string
  name: string
  facets: Record<string, unknown>
  inputFacets?: Record<string, unknown>
  outputFacets?: Record<string, unknown>
}

export interface OpenLineageRunEvent {
  eventType: LineageEventType
  eventTime: string
  run: { runId: string; facets: Record<string, unknown> }
  job: { namespace: string; name: string; facets: Record<string, unknown> }
  inputs: OpenLineageDataset[]
  outputs: OpenLineageDataset[]
  producer: string
  schemaURL: string
}

const FACET_PRODUCER = 'https://github.com/sheetbase-labs/sheetbase-eln'

function facetBase(schema: string) {
  return {
    _producer: FACET_PRODUCER,
    _schemaURL: `https://openlineage.io/spec/facets/1-0-0/${schema}.json`,
  }
}

function datasetOf(
  namespace: string,
  ref: LineageDatasetRef,
): OpenLineageDataset {
  const facets: Record<string, unknown> = {}

  if (ref.versionId) {
    facets.version = {
      ...facetBase('DatasetVersionDatasetFacet'),
      datasetVersion: ref.versionId,
    }
  }

  if (ref.columns && ref.columns.length > 0) {
    facets.schema = {
      ...facetBase('SchemaDatasetFacet'),
      fields: ref.columns.map((name) => ({ name })),
    }
  }

  return { namespace, name: `datasets/${ref.datasetId}`, facets }
}

/** Output columns that exist by the same name in an input, as column lineage. */
export function columnLineageFor(
  namespace: string,
  inputs: LineageDatasetRef[],
  output: LineageDatasetRef,
): Record<string, unknown> | null {
  const fields: Record<string, unknown> = {}

  for (const column of output.columns ?? []) {
    const sources = inputs
      .filter((input) =>
        (input.columns ?? []).some(
          (c) => c.toLowerCase() === column.toLowerCase(),
        ),
      )
      .map((input) => ({
        namespace,
        name: `datasets/${input.datasetId}`,
        field: column,
      }))

    if (sources.length > 0) {
      fields[column] = {
        inputFields: sources,
        transformationDescription: 'Matched by column name',
        transformationType: 'IDENTITY',
      }
    }
  }

  return Object.keys(fields).length > 0
    ? { ...facetBase('ColumnLineageDatasetFacet'), fields }
    : null
}

export function buildRunEvent(
  activity: LineageActivity,
  namespace: string,
  producerVersion: string,
): OpenLineageRunEvent {
  const outputs = activity.outputs.map((ref) => {
    const dataset = datasetOf(namespace, ref)
    const lineage = columnLineageFor(namespace, activity.inputs, ref)

    if (lineage) dataset.facets.columnLineage = lineage

    return dataset
  })

  const runFacets: Record<string, unknown> = {}

  if (activity.errorMessage) {
    runFacets.errorMessage = {
      ...facetBase('ErrorMessageRunFacet'),
      message: activity.errorMessage,
      programmingLanguage: 'n/a',
    }
  }

  return {
    eventType: activity.eventType,
    eventTime: activity.eventTime,
    run: { runId: activity.runId, facets: runFacets },
    job: {
      namespace,
      name: activity.jobName,
      facets: {
        jobType: {
          ...facetBase('JobTypeJobFacet'),
          processingType: 'BATCH',
          integration: 'SHEETBASE',
          jobType: activity.jobType,
        },
      },
    },
    inputs: activity.inputs.map((ref) => datasetOf(namespace, ref)),
    outputs,
    producer: `${FACET_PRODUCER}/${producerVersion}`,
    schemaURL: OPENLINEAGE_SCHEMA_URL,
  }
}

/** A change event's meaning for lineage, before the rows behind it are read. */
export interface LineageChange {
  entityType: string
  operation: string
  payload: Record<string, unknown>
}

export interface LineageIntent {
  kind: LineageActivity['jobType']
  /** What to read to finish the activity. */
  eventType: LineageEventType | 'FROM_STATUS'
}

/** Which change events matter to lineage, and as what. Null for the rest. */
export function lineageIntent(change: LineageChange): LineageIntent | null {
  const status = change.payload.status

  switch (change.entityType) {
    case 'pipeline_run':
      return change.operation === 'create'
        ? { kind: 'PIPELINE', eventType: 'START' }
        : change.operation === 'update'
          ? { kind: 'PIPELINE', eventType: 'FROM_STATUS' }
          : null
    case 'dataset_import':
      if (change.operation === 'create')
        return { kind: 'IMPORT', eventType: 'START' }

      if (status === 'committed')
        return { kind: 'IMPORT', eventType: 'COMPLETE' }

      if (status === 'failed') return { kind: 'IMPORT', eventType: 'FAIL' }

      return null
    case 'instrument_run':
      if (change.operation === 'create')
        return { kind: 'INSTRUMENT', eventType: 'START' }

      if (status === 'completed')
        return { kind: 'INSTRUMENT', eventType: 'COMPLETE' }

      if (status === 'failed') return { kind: 'INSTRUMENT', eventType: 'FAIL' }

      return null
    case 'plate_run':
      return change.operation === 'create'
        ? { kind: 'PLATE', eventType: 'COMPLETE' }
        : null
    case 'plate_worklist':
      if (change.operation === 'create')
        return { kind: 'WORKLIST', eventType: 'START' }

      return payloadSaysCompleted(change.payload)
        ? { kind: 'WORKLIST', eventType: 'COMPLETE' }
        : null
    default:
      return null
  }
}

function payloadSaysCompleted(payload: Record<string, unknown>): boolean {
  return payload.status === 'completed' || payload.action === 'completed'
}

/** The lineage event type for a pipeline run's status; null while it is not over. */
export function eventTypeForRunStatus(status: string): LineageEventType | null {
  if (status === 'succeeded') return 'COMPLETE'

  if (status === 'failed') return 'FAIL'

  if (status === 'cancelled') return 'ABORT'

  return null
}
