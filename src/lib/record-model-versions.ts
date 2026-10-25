import { z } from 'zod'

import { FIELD_LOGICAL_TYPES } from './field-definition'
import type { DataClient } from './data-client'

export const RECORD_MODEL_VERSION_KIND = 'record_model_version'

/**
 * MDL-02.3 — the steward's choice, made after seeing the impact and before a
 * field change is applied, about records pinned to an earlier version. It is
 * carried on the versioned definition so the apply RPC receives and records
 * it; publication itself never rewrites recorded values.
 */
export type ModelChangeScope =
  'new-records-only' | 'also-migrate-open-experiments'

export const MODEL_CHANGE_SCOPES: readonly ModelChangeScope[] = [
  'new-records-only',
  'also-migrate-open-experiments',
]

// IDs name canonical fields, not per-version copies. Unknown semantic metadata
// is retained so editing a label cannot discard units, rules or relationships.
const fieldSchema = z
  .object({
    id: z.uuid(),
    field_name: z.string().min(1),
    label: z.string().min(1),
    logical_type: z.enum(FIELD_LOGICAL_TYPES),
    nullable: z.boolean(),
    display_order: z.number().int(),
    lifecycle: z.enum(['active', 'retired']),
    default_value: z.unknown(),
    validation: z.record(z.string(), z.unknown()),
    cardinality: z.enum(['one', 'many']),
    quantity: z
      .object({
        kind: z.string(),
        dimension: z.string(),
        storageUnit: z.string(),
      })
      .passthrough()
      .nullable()
      .optional(),
    options: z
      .array(
        z
          .object({
            id: z.uuid(),
            key: z.string(),
            label: z.string(),
            displayOrder: z.number().int(),
            lifecycle: z.enum(['active', 'retired']),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough()

export const recordModelVersionSchema = z
  .object({
    id: z.uuid(),
    model_id: z.uuid(),
    workspace_id: z.uuid(),
    version: z.number().int().positive(),
    revision: z.number().int().positive(),
    lifecycle: z.enum(['draft', 'published']),
    definition: z.object({ fields: z.array(fieldSchema) }).passthrough(),
    reason: z.string(),
    created_at: z.string(),
    created_by_user_id: z.string().nullable(),
    published_at: z.string().nullable(),
  })
  .passthrough()

export type RecordModelVersion = z.infer<typeof recordModelVersionSchema>
export type RecordModelVersionDefinition = RecordModelVersion['definition']

const usageSchema = z.object({
  version_id: z.uuid(),
  record_count: z.number().int().nonnegative(),
  created_record_count: z.number().int().nonnegative(),
  upgraded_record_count: z.number().int().nonnegative(),
  migratable_record_count: z.number().int().nonnegative(),
})

export async function listRecordModelVersionUsage(
  client: DataClient,
  modelId: string,
) {
  return z.array(usageSchema).parse(
    await client.rpc('record_model_version_usage', {
      p_model_id: modelId,
    }),
  )
}

export async function listRecordModelVersions(
  client: DataClient,
  modelId: string,
) {
  const rows = await client.list<unknown>(
    'record_model_versions',
    `?model_id=eq.${encodeURIComponent(modelId)}&order=version.desc`,
  )
  return z.array(recordModelVersionSchema).parse(rows)
}

export async function createRecordModelVersion(
  client: DataClient,
  input: { modelId: string; reason: string },
) {
  return recordModelVersionSchema.parse(
    await client.rpc('create_record_model_version', {
      p_model_id: input.modelId,
      p_reason: input.reason,
    }),
  )
}

export async function replaceRecordModelVersionDefinition(
  client: DataClient,
  input: {
    versionId: string
    expectedRevision: number
    definition: RecordModelVersionDefinition
    reason: string
    migrationScope?: ModelChangeScope
  },
) {
  const version = recordModelVersionSchema.parse(
    await client.rpc('replace_record_model_version_definition', {
      p_version_id: input.versionId,
      p_expected_revision: input.expectedRevision,
      // The scope travels in the definition payload, so the existing evolution
      // RPC receives it. A definition-only edit leaves it untouched.
      p_definition: input.migrationScope
        ? { ...input.definition, migrationScope: input.migrationScope }
        : input.definition,
      p_reason: input.reason,
    }),
  )
  return version
}

export interface ModelMigrationResult {
  migrated: number
  recordIds: string[]
}

/**
 * MDL-02.3 — "also migrate open experiments" is a real migration.
 *
 * The definition edit records the steward's choice; this is what honours it. It
 * upgrades the records the impact panel counted: those pinned to an older version
 * of the same model that are not archived, deleted or already approved. Each
 * record goes through the canonical per-record upgrade, so every migration is
 * attributed and audited. The batch is all-or-nothing: a refusal rolls the whole
 * call back rather than leaving half the records moved.
 */
export async function migrateOpenExperimentsToModelVersion(
  client: DataClient,
  input: { modelId: string; versionId: string; reason: string },
): Promise<ModelMigrationResult> {
  const result = await client.rpc<{ migrated: number; recordIds: string[] }>(
    'migrate_open_experiments_to_model_version',
    {
      p_model_id: input.modelId,
      p_version_id: input.versionId,
      p_reason: input.reason,
    },
  )
  return { migrated: result.migrated, recordIds: result.recordIds }
}

/** Abandon an unsubmitted draft; the published version stays current. */
export async function discardRecordModelVersion(
  client: DataClient,
  versionId: string,
) {
  await client.rpc('discard_record_model_version', {
    p_version_id: versionId,
  })
}

export async function publishRecordModelVersion(
  client: DataClient,
  versionId: string,
) {
  await client.rpc('publish_record_model_version', { p_version_id: versionId })
}

export async function upgradeRecordModelRecord(
  client: DataClient,
  input: {
    recordId: string
    versionId: string
    expectedMetadataVersion: number
    reason: string
  },
) {
  // Upgrades change the definition pin only. Values are never sent to this RPC.
  await client.rpc('upgrade_record_model_record', {
    p_record_id: input.recordId,
    p_version_id: input.versionId,
    p_expected_metadata_version: input.expectedMetadataVersion,
    p_reason: input.reason,
  })
}
