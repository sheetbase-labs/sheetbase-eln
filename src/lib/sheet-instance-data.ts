import { z } from 'zod'

import { createDataClient } from './data-client'
import type { DataClient } from './data-client'
import { sheetDefinitionUuidSchema as uuid } from './sheet-definition'
import { sheetInstanceStateSchema } from './sheet-instance'
import type { SheetInstanceState } from './sheet-instance'

const timestamp = z.string().datetime({ offset: true })
const nullableUuid = uuid.nullable()
const revision = z
  .union([z.number(), z.string().regex(/^\d+$/)])
  .transform(Number)
  .pipe(z.number().int().positive().safe())

export const sheetInstanceWireSchema = z
  .object({
    id: uuid,
    workspace_id: uuid,
    project_id: nullableUuid,
    notebook_record_id: nullableUuid,
    source_definition_version_id: nullableUuid,
    name: z.string().trim().min(1).max(200),
    description: z.string().max(2_000).nullable(),
    lifecycle: z.enum(['active', 'archived']),
    revision,
    state: sheetInstanceStateSchema,
    duplicated_from_instance_id: nullableUuid,
    created_at: timestamp,
    updated_at: timestamp,
    created_by_user_id: z.string().nullable(),
    updated_by_user_id: z.string().nullable(),
  })
  .strict()

export type SheetInstanceWire = z.input<typeof sheetInstanceWireSchema>
export type SheetParameterInput =
  | { parameterId: string; kind: 'scalar'; value: unknown }
  | { parameterId: string; kind: 'record'; recordId: string }
  | { parameterId: string; kind: 'dataset'; datasetId: string }
  | {
      parameterId: string
      kind: 'dataset-version'
      datasetVersionId: string
    }
export interface SheetInstance {
  id: string
  workspaceId: string
  projectId: string | null
  notebookRecordId: string | null
  sourceDefinitionVersionId: string | null
  name: string
  description: string | null
  lifecycle: 'active' | 'archived'
  revision: number
  state: SheetInstanceState
  duplicatedFromInstanceId: string | null
  createdAt: string
  updatedAt: string
  createdByUserId: string | null
  updatedByUserId: string | null
}

export const sheetInstanceDataClient = createDataClient()

export function sheetInstanceFromWire(wire: unknown): SheetInstance {
  const parsed = sheetInstanceWireSchema.parse(wire)
  return {
    id: parsed.id,
    workspaceId: parsed.workspace_id,
    projectId: parsed.project_id,
    notebookRecordId: parsed.notebook_record_id,
    sourceDefinitionVersionId: parsed.source_definition_version_id,
    name: parsed.name,
    description: parsed.description,
    lifecycle: parsed.lifecycle,
    revision: parsed.revision,
    state: parsed.state,
    duplicatedFromInstanceId: parsed.duplicated_from_instance_id,
    createdAt: parsed.created_at,
    updatedAt: parsed.updated_at,
    createdByUserId: parsed.created_by_user_id,
    updatedByUserId: parsed.updated_by_user_id,
  }
}

export async function fetchSheetInstances(
  client: DataClient = sheetInstanceDataClient,
) {
  const rows = await client.list<unknown>(
    'sheet_instances',
    '?order=created_at.asc,id.asc',
  )
  return rows.map(sheetInstanceFromWire)
}

type CreateInput = {
  workspaceId: string
  name: string
  description?: string | null
  projectId?: string | null
  notebookRecordId?: string | null
  state: SheetInstanceState
}

async function create(
  input: CreateInput,
  sourceVersionId: string | null,
  client: DataClient,
) {
  const row = await client.rpc<unknown>('create_sheet_instance', {
    p_workspace_id: input.workspaceId,
    p_name: input.name,
    p_description: input.description ?? null,
    p_source_definition_version_id: sourceVersionId,
    p_project_id: input.projectId ?? null,
    p_notebook_record_id: input.notebookRecordId ?? null,
    p_state: input.state,
  })
  return sheetInstanceFromWire(row)
}

export function createAdHocSheetInstance(
  input: CreateInput,
  client = sheetInstanceDataClient,
) {
  return create(input, null, client)
}

export function createSheetInstanceFromDefinition(
  input: CreateInput & {
    sourceDefinitionVersionId: string
    parameterInputs: SheetParameterInput[]
  },
  client = sheetInstanceDataClient,
) {
  return client
    .rpc<unknown>('create_sheet_instance_from_definition', {
      p_workspace_id: input.workspaceId,
      p_name: input.name,
      p_description: input.description ?? null,
      p_source_definition_version_id: input.sourceDefinitionVersionId,
      p_project_id: input.projectId ?? null,
      p_notebook_record_id: input.notebookRecordId ?? null,
      p_state: input.state,
      p_parameter_inputs: input.parameterInputs,
    })
    .then(sheetInstanceFromWire)
}

export async function updateSheetInstance(
  id: string,
  expectedRevision: number,
  state: SheetInstanceState,
  client = sheetInstanceDataClient,
) {
  const row = await client.rpc<unknown>('update_sheet_instance', {
    p_instance_id: id,
    p_expected_revision: expectedRevision,
    p_state: state,
  })
  return sheetInstanceFromWire(row)
}

export async function resolveSheetInstanceRowIdentity(
  id: string,
  expectedRevision: number,
  client = sheetInstanceDataClient,
) {
  const row = await client.rpc<unknown>('resolve_sheet_instance_row_identity', {
    p_instance_id: id,
    p_expected_revision: expectedRevision,
  })
  return sheetInstanceFromWire(row)
}

export async function archiveSheetInstance(
  id: string,
  expectedRevision: number,
  client = sheetInstanceDataClient,
) {
  const row = await client.rpc<unknown>('archive_sheet_instance', {
    p_instance_id: id,
    p_expected_revision: expectedRevision,
  })
  return sheetInstanceFromWire(row)
}

export async function duplicateSheetInstance(
  id: string,
  expectedRevision: number,
  name: string,
  client = sheetInstanceDataClient,
) {
  const row = await client.rpc<unknown>('duplicate_sheet_instance', {
    p_instance_id: id,
    p_expected_revision: expectedRevision,
    p_name: name,
  })
  return sheetInstanceFromWire(row)
}
