import { z } from 'zod'

/** One value as a `jsonb` column holds it. */
const jsonValue = z.json()

type SheetEvidenceJson = z.output<typeof jsonValue>

/** A stored JSON object: what a sheet's state, grid columns and bindings are. */
const jsonObjectSchema = z.record(z.string(), jsonValue)

type SheetEvidenceObject = z.output<typeof jsonObjectSchema>

export type FrozenSheetEvidence = {
  blockId: string
  instanceId: string
  instanceRevision: number
  sourceDefinitionVersionId: string | null
  instanceState: SheetEvidenceObject
  datasetBindings: SheetEvidenceObject[]
  composedGrid?: {
    columns?: SheetEvidenceObject[]
    rowKeys?: SheetEvidenceJson
    rows?: SheetEvidenceJson
    fields?: SheetEvidenceJson
    calculations?: SheetEvidenceJson
  } | null
}

/**
 * A frozen sheet's composed grid, decoded from stored JSON. A non-object is no
 * grid at all; a column that is not an object is kept as an empty one, so the
 * grid still lines up with its rows.
 */
const composedGridSchema = z
  .object({
    columns: z
      .array(jsonValue)
      .transform((columns) =>
        columns.map((column) => jsonObjectSchema.catch({}).parse(column)),
      )
      .optional(),
    rowKeys: jsonValue.optional(),
    rows: jsonValue.optional(),
    fields: jsonValue.optional(),
    calculations: jsonValue.optional(),
  })
  .nullable()
  .catch(null)

/** The bindings a frozen sheet was computed from: its stored dataset versions. */
const datasetBindingsSchema = z
  .array(jsonValue)
  .catch([])
  .transform((bindings) =>
    bindings.flatMap((binding) => {
      const parsed = jsonObjectSchema.safeParse(binding)

      return parsed.success ? [parsed.data] : []
    }),
  )

/** One evidence item as the notebook envelope carries it, before decoding. */
const envelopeItemSchema = z.object({
  blockId: z.string(),
  instanceId: z.string(),
  instanceRevision: z.union([z.number(), z.string()]).optional(),
  sourceDefinitionVersionId: z.string().nullable().optional(),
  instanceState: z.unknown().optional(),
  datasetBindings: z.unknown().optional(),
  composedGrid: z.unknown().optional(),
})

/** A stored evidence row, before decoding: the database returns these as JSON. */
export interface RevisionSheetEvidenceRow {
  block_id: string
  instance_id: string
  instance_revision: number | string
  source_definition_version_id: string | null
  instance_state: unknown
  dataset_versions: unknown
  composed_grid: unknown
}

export function sheetEvidenceFromRevisionRows(
  rows: readonly RevisionSheetEvidenceRow[],
): Map<string, FrozenSheetEvidence> {
  const map = new Map<string, FrozenSheetEvidence>()

  for (const row of rows) {
    map.set(row.block_id, {
      blockId: row.block_id,
      instanceId: row.instance_id,
      instanceRevision: Number(row.instance_revision),
      sourceDefinitionVersionId: row.source_definition_version_id,
      instanceState: jsonObjectSchema.catch({}).parse(row.instance_state),
      datasetBindings: datasetBindingsSchema.parse(row.dataset_versions),
      composedGrid: composedGridSchema.parse(row.composed_grid),
    })
  }

  return map
}

export function sheetEvidenceFromEnvelope(
  envelope: { sheetEvidence?: unknown } | null | undefined,
): Map<string, FrozenSheetEvidence> {
  const map = new Map<string, FrozenSheetEvidence>()
  const items = z.array(z.unknown()).catch([]).parse(envelope?.sheetEvidence)

  for (const item of items) {
    const parsed = envelopeItemSchema.safeParse(item)

    if (!parsed.success) continue
    const found = parsed.data
    map.set(found.blockId, {
      blockId: found.blockId,
      instanceId: found.instanceId,
      instanceRevision: Number(found.instanceRevision ?? 0),
      sourceDefinitionVersionId: found.sourceDefinitionVersionId ?? null,
      instanceState: jsonObjectSchema.catch({}).parse(found.instanceState),
      datasetBindings: datasetBindingsSchema.parse(found.datasetBindings),
      composedGrid: composedGridSchema.parse(found.composedGrid),
    })
  }

  return map
}
