import { z } from 'zod'

import { createDataClient } from './data-client'
import type { DataClient } from './data-client'
import { parseNotebookTemplateConfiguration } from './notebook-template'
import { parseNotebookTemplateUpgradePreviewFromWire } from './notebook-template-upgrade'
import type { NotebookTemplateConfiguration } from './notebook-template'
import { parameterUuidSchema, rfc3339TimestampSchema } from './parameter'

const uuid = parameterUuidSchema
const timestamp = rfc3339TimestampSchema
const revision = z
  .union([z.number(), z.string().regex(/^\d+$/)])
  .transform(Number)
  .pipe(z.number().int().positive().safe())

export const notebookTemplateWireSchema = z
  .object({
    id: uuid,
    workspace_id: uuid,
    key: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    display_id: z.string().nullable(),
    lifecycle: z.enum(['active', 'retired']),
    revision,
    created_at: timestamp,
    updated_at: timestamp,
    created_by_user_id: z.string().nullable(),
    updated_by_user_id: z.string().nullable(),
  })
  .strict()

export const notebookTemplateVersionWireSchema = z
  .object({
    id: uuid,
    template_id: uuid,
    version: z.number().int().positive(),
    lifecycle: z.enum(['draft', 'published', 'retired']),
    configuration_format_version: z.literal(1),
    configuration: z.unknown(),
    revision,
    created_at: timestamp,
    updated_at: timestamp,
    created_by_user_id: z.string().nullable(),
    updated_by_user_id: z.string().nullable(),
    published_at: timestamp.nullable(),
    published_by_user_id: z.string().nullable(),
    retired_at: timestamp.nullable(),
    retired_by_user_id: z.string().nullable(),
  })
  .strict()

export type NotebookTemplate = {
  id: string
  workspaceId: string
  key: string
  name: string
  description: string | null
  lifecycle: 'active' | 'retired'
  revision: number
  displayId: string | null
  createdAt: string
  updatedAt: string
  createdByUserId: string | null
}

export type NotebookTemplateVersion = {
  id: string
  templateId: string
  version: number
  lifecycle: 'draft' | 'published' | 'retired'
  configuration: NotebookTemplateConfiguration
  revision: number
  publishedAt: string | null
}

export type NotebookTemplateParameterInput =
  | { parameterId: string; kind: 'scalar'; value: unknown }
  | { parameterId: string; kind: 'record'; recordId: string }
  | { parameterId: string; kind: 'dataset'; datasetId: string }
  | {
      parameterId: string
      kind: 'dataset-version'
      datasetVersionId: string
    }

/**
 * REUSE-02: per-placement composition pins stored on the instantiation
 * result. Governed pins (`templateVersionId`, `definitionVersionId`) name
 * the exact published versions composed; working-state IDs (`instanceId`,
 * `blockId`) name the independent local state each part received. Upgrade
 * detection reads these pins without starting an upgrade flow.
 */
export interface NotebookTemplateInstantiationComposition {
  placementId: string
  kind: string
  /** Governed pin: exact published Sheet Definition Version composed. */
  definitionVersionId?: string
  /** Independent working state created for this part. */
  instanceId?: string
  /** Notebook block hosting this part's working state. */
  blockId?: string
  blockType?: string
}

export interface NotebookTemplateInstantiationResult {
  record: { id: string; project_id: string | null; identifier: string }
  templateVersionId: string
  composition: NotebookTemplateInstantiationComposition[]
  idempotent: boolean
}

export const notebookTemplateDataClient = createDataClient()

export function notebookTemplateFromWire(wire: unknown): NotebookTemplate {
  const parsed = notebookTemplateWireSchema.parse(wire)
  return {
    id: parsed.id,
    workspaceId: parsed.workspace_id,
    key: parsed.key,
    name: parsed.name,
    description: parsed.description,
    lifecycle: parsed.lifecycle,
    revision: parsed.revision,
    displayId: parsed.display_id,
    createdAt: parsed.created_at,
    updatedAt: parsed.updated_at,
    createdByUserId: parsed.created_by_user_id,
  }
}

export function notebookTemplateVersionFromWire(
  wire: unknown,
): NotebookTemplateVersion {
  const parsed = notebookTemplateVersionWireSchema.parse(wire)
  return {
    id: parsed.id,
    templateId: parsed.template_id,
    version: parsed.version,
    lifecycle: parsed.lifecycle,
    configuration: parseNotebookTemplateConfiguration(parsed.configuration),
    revision: parsed.revision,
    publishedAt: parsed.published_at,
  }
}

export async function fetchNotebookTemplates(
  client: DataClient = notebookTemplateDataClient,
  options: { search?: string; limit?: number } = {},
) {
  const limit = options.limit ?? 100
  const terms: string[] = [`order=updated_at.desc,name.asc`, `limit=${limit}`]
  const search = options.search?.trim()
  if (search) {
    const needle = `*${search.replace(/[,*()]/g, ' ').trim()}*`
    terms.push(
      `or=(name.ilike.${encodeURIComponent(needle)},key.ilike.${encodeURIComponent(needle)})`,
    )
  }
  const rows = await client.list<unknown>(
    'notebook_templates',
    `?${terms.join('&')}`,
  )
  return rows.map(notebookTemplateFromWire)
}

export async function fetchNotebookTemplate(
  templateId: string,
  client: DataClient = notebookTemplateDataClient,
) {
  const rows = await client.list<unknown>(
    'notebook_templates',
    `?id=eq.${encodeURIComponent(templateId)}&limit=1`,
  )
  const row = rows[0]
  return row === undefined ? null : notebookTemplateFromWire(row)
}

export async function fetchNotebookTemplateVersion(
  versionId: string,
  client: DataClient = notebookTemplateDataClient,
) {
  const rows = await client.list<unknown>(
    'notebook_template_versions',
    `?id=eq.${encodeURIComponent(versionId)}&limit=1`,
  )
  const row = rows[0]
  return row === undefined ? null : notebookTemplateVersionFromWire(row)
}

export async function fetchNotebookTemplateVersions(
  templateId: string,
  client: DataClient = notebookTemplateDataClient,
) {
  const rows = await client.list<unknown>(
    'notebook_template_versions',
    `?template_id=eq.${encodeURIComponent(templateId)}&order=version.asc`,
  )
  return rows.map(notebookTemplateVersionFromWire)
}

export async function fetchAllNotebookTemplateVersions(
  client: DataClient = notebookTemplateDataClient,
) {
  const rows = await client.list<unknown>(
    'notebook_template_versions',
    '?order=template_id.asc,version.desc&limit=2000',
  )
  return rows.map(notebookTemplateVersionFromWire)
}

export async function createNotebookTemplate(
  input: {
    workspaceId: string
    key: string
    name: string
    description?: string | null
    configuration: NotebookTemplateConfiguration
  },
  client: DataClient = notebookTemplateDataClient,
) {
  const result = await client.rpc<{ template: unknown; version: unknown }>(
    'create_notebook_template',
    {
      p_workspace_id: input.workspaceId,
      p_key: input.key,
      p_name: input.name,
      p_description: input.description ?? null,
      p_configuration: input.configuration,
    },
  )
  return {
    template: notebookTemplateFromWire(result.template),
    version: notebookTemplateVersionFromWire(result.version),
  }
}

export async function publishNotebookTemplateVersion(
  versionId: string,
  expectedRevision: number,
  client: DataClient = notebookTemplateDataClient,
) {
  const row = await client.rpc<unknown>('publish_notebook_template_version', {
    p_version_id: versionId,
    p_expected_revision: expectedRevision,
  })
  return notebookTemplateVersionFromWire(row)
}

export async function createNotebookTemplateVersion(
  templateId: string,
  expectedTemplateRevision: number,
  configuration: NotebookTemplateConfiguration,
  client: DataClient = notebookTemplateDataClient,
) {
  const row = await client.rpc<unknown>('create_notebook_template_version', {
    p_template_id: templateId,
    p_expected_template_revision: expectedTemplateRevision,
    p_configuration: configuration,
  })
  return notebookTemplateVersionFromWire(row)
}

export async function instantiateNotebookTemplateVersion(
  input: {
    versionId: string
    targetProjectId: string
    title?: string
    parameterInputs?: NotebookTemplateParameterInput[]
    idempotencyKey: string
  },
  client: DataClient = notebookTemplateDataClient,
) {
  return client.rpc<NotebookTemplateInstantiationResult>(
    'instantiate_notebook_template_version',
    {
      p_version_id: input.versionId,
      p_target_project_id: input.targetProjectId,
      p_title: input.title ?? null,
      p_parameter_inputs: input.parameterInputs ?? [],
      p_idempotency_key: input.idempotencyKey,
    },
  )
}

export async function fetchSheetInstanceNotebookEmbeddings(
  instanceId: string,
  client: DataClient = notebookTemplateDataClient,
) {
  return client.rpc<{
    instanceId: string
    count: number
    embeddings: Array<{
      blockId: string
      recordId: string
      identifier: string
      title: string
    }>
  }>('sheet_instance_notebook_embeddings', {
    p_instance_id: instanceId,
  })
}

export async function previewNotebookTemplateUpgrade(
  recordId: string,
  targetVersionId: string,
  client: DataClient = notebookTemplateDataClient,
) {
  const result = await client.rpc<unknown>(
    'preview_notebook_template_upgrade',
    {
      p_record_id: recordId,
      p_target_version_id: targetVersionId,
    },
  )
  return parseNotebookTemplateUpgradePreviewFromWire(result)
}

export async function applyNotebookTemplateUpgrade(
  input: {
    recordId: string
    expectedStructureVersion: number
    targetVersionId: string
    decisions?: unknown[]
    parameterInputs?: NotebookTemplateParameterInput[]
  },
  client: DataClient = notebookTemplateDataClient,
) {
  return client.rpc<unknown>('apply_notebook_template_upgrade', {
    p_record_id: input.recordId,
    p_expected_structure_version: input.expectedStructureVersion,
    p_target_version_id: input.targetVersionId,
    p_decisions: input.decisions ?? [],
    p_parameter_inputs: input.parameterInputs ?? [],
  })
}

export async function retireNotebookTemplateVersion(
  versionId: string,
  expectedRevision: number,
  client: DataClient = notebookTemplateDataClient,
) {
  const row = await client.rpc<unknown>('retire_notebook_template_version', {
    p_version_id: versionId,
    p_expected_revision: expectedRevision,
  })
  return notebookTemplateVersionFromWire(row)
}

export async function retargetNotebookTemplateSheetPlacement(
  input: {
    versionId: string
    expectedRevision: number
    placementId: string
    targetDefinitionVersionId: string
  },
  client: DataClient = notebookTemplateDataClient,
) {
  const row = await client.rpc<unknown>(
    'retarget_notebook_template_sheet_placement',
    {
      p_version_id: input.versionId,
      p_expected_revision: input.expectedRevision,
      p_placement_id: input.placementId,
      p_target_definition_version_id: input.targetDefinitionVersionId,
    },
  )
  return notebookTemplateVersionFromWire(row)
}
