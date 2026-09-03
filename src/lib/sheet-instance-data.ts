import { z } from 'zod'

import { createDataClient } from './data-client'
import type { DataClient } from './data-client'
import { sheetDefinitionUuidSchema as uuid } from './sheet-definition'
import {
  parseSheetDefinitionUpgradeDecisions,
  parseSheetDefinitionUpgradePreview,
} from './sheet-definition-upgrade'
import type {
  SheetDefinitionUpgradeDecision,
  SheetDefinitionUpgradePreview,
} from './sheet-definition-upgrade'
import { rfc3339TimestampSchema } from './parameter'
import { sheetInstanceStateSchema } from './sheet-instance'
import type { SheetInstanceState } from './sheet-instance'

const timestamp = rfc3339TimestampSchema
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
    // Attribution columns the table carries but the app does not consume;
    // declared so the strict wire schema accepts the PostgREST payload.
    created_by_credential_id: nullableUuid,
    updated_by_credential_id: nullableUuid,
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

export async function fetchSheetInstance(
  id: string,
  client: DataClient = sheetInstanceDataClient,
) {
  const rows = await client.list<unknown>(
    'sheet_instances',
    `?id=eq.${encodeURIComponent(id)}&limit=1`,
  )
  const row = rows[0]
  return row === undefined ? null : sheetInstanceFromWire(row)
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

type DefinitionCreateInput = Omit<CreateInput, 'state'> & {
  state: Omit<SheetInstanceState, 'presentation'> & {
    presentation?: SheetInstanceState['presentation']
  }
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
  input: DefinitionCreateInput & {
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

export async function previewSheetInstanceDefinitionUpgrade(
  instanceId: string,
  expectedRevision: number,
  targetDefinitionVersionId: string,
  client = sheetInstanceDataClient,
): Promise<SheetDefinitionUpgradePreview> {
  const result = await client.rpc<unknown>(
    'preview_sheet_instance_definition_upgrade',
    {
      p_instance_id: uuid.parse(instanceId),
      p_expected_instance_revision: expectedRevision,
      p_target_definition_version_id: uuid.parse(targetDefinitionVersionId),
    },
  )
  return parseSheetDefinitionUpgradePreview(result)
}

export async function applySheetInstanceDefinitionUpgrade(
  input: {
    instanceId: string
    expectedRevision: number
    targetDefinitionVersionId: string
    decisions: SheetDefinitionUpgradeDecision[]
    parameterInputs?: SheetParameterInput[]
  },
  client = sheetInstanceDataClient,
): Promise<
  | { status: 'deferred'; preview: SheetDefinitionUpgradePreview }
  | {
      status: 'applied'
      preview: SheetDefinitionUpgradePreview
      instance: SheetInstance
      provenance: {
        sourceDefinitionVersionId: string
        targetDefinitionVersionId: string
        sourceInstanceRevision: number
        resultingInstanceRevision: number
        actorUserId: string
        upgradedAt: string
        decisions: SheetDefinitionUpgradeDecision[]
      }
    }
> {
  const decisions = parseSheetDefinitionUpgradeDecisions(input.decisions)
  const result = await client.rpc<any>(
    'apply_sheet_instance_definition_upgrade',
    {
      p_instance_id: uuid.parse(input.instanceId),
      p_expected_instance_revision: input.expectedRevision,
      p_target_definition_version_id: uuid.parse(
        input.targetDefinitionVersionId,
      ),
      p_decisions: decisions,
      p_parameter_inputs: input.parameterInputs ?? [],
    },
  )
  const preview = parseSheetDefinitionUpgradePreview(result.preview)
  if (result.status === 'deferred') return { status: 'deferred', preview }
  if (result.status !== 'applied')
    throw new Error('Unknown Sheet Definition upgrade result status.')
  return {
    status: 'applied',
    preview,
    instance: sheetInstanceFromWire(result.instance),
    provenance: {
      sourceDefinitionVersionId: uuid.parse(
        result.provenance.sourceDefinitionVersionId,
      ),
      targetDefinitionVersionId: uuid.parse(
        result.provenance.targetDefinitionVersionId,
      ),
      sourceInstanceRevision: revision.parse(
        result.provenance.sourceInstanceRevision,
      ),
      resultingInstanceRevision: revision.parse(
        result.provenance.resultingInstanceRevision,
      ),
      actorUserId: z.string().min(1).parse(result.provenance.actorUserId),
      upgradedAt: timestamp.parse(result.provenance.upgradedAt),
      decisions,
    },
  }
}
