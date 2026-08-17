import { z } from 'zod'

import { createDataClient } from './data-client'
import type { DataClient } from './data-client'
import { sheetDefinitionUuidSchema as uuid } from './sheet-definition'
import { sheetInstanceFromWire } from './sheet-instance-data'
import type { SheetInstance, SheetParameterInput } from './sheet-instance-data'

const previewSchema = z
  .object({
    instanceId: uuid,
    instanceRevision: z.number().int().positive(),
    notebookRecordId: uuid.nullable(),
    compatible: z.boolean(),
    errorCode: z.string().nullable().optional(),
    errorMessage: z.string().nullable().optional(),
    unmatchedLocalRowKeys: z.array(z.string()).default([]),
    preserved: z
      .object({
        instanceId: uuid,
        notebookRecordId: uuid.nullable(),
        localFieldIds: z.array(uuid),
        localValueRowCount: z.number().int().min(0),
        instanceCalculationIds: z.array(uuid),
      })
      .passthrough(),
    target: z
      .object({
        definitionId: uuid,
        versionId: uuid,
        version: z.number().int().positive(),
        workspaceId: uuid,
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

export type SheetCompositionAdoptionPreview = z.infer<typeof previewSchema>

export type SheetCompositionAdoptionResult =
  | {
      status: 'applied'
      idempotent: boolean
      preview: SheetCompositionAdoptionPreview
      instance: SheetInstance
      unmatchedLocalRowKeys: string[]
    }
  | { status: 'incompatible'; preview: SheetCompositionAdoptionPreview }

export async function previewSheetInstanceCompositionAdoption(
  input: {
    instanceId: string
    expectedRevision: number
    targetDefinitionVersionId: string
    parameterInputs?: SheetParameterInput[]
  },
  client: DataClient = createDataClient(),
): Promise<SheetCompositionAdoptionPreview> {
  return previewSchema.parse(
    await client.rpc('preview_sheet_instance_composition_adoption', {
      p_instance_id: uuid.parse(input.instanceId),
      p_expected_instance_revision: input.expectedRevision,
      p_target_definition_version_id: uuid.parse(
        input.targetDefinitionVersionId,
      ),
      p_parameter_inputs: input.parameterInputs ?? [],
    }),
  )
}

export async function applySheetInstanceCompositionAdoption(
  input: {
    instanceId: string
    expectedRevision: number
    targetDefinitionVersionId: string
    parameterInputs?: SheetParameterInput[]
    retryToken: string
  },
  client: DataClient = createDataClient(),
): Promise<SheetCompositionAdoptionResult> {
  const preview = await previewSheetInstanceCompositionAdoption(input, client)
  if (!preview.compatible) return { status: 'incompatible', preview }
  const result = await client.rpc<{
    status: string
    idempotent?: boolean
    preview: unknown
    instance: unknown
    unmatchedLocalRowKeys?: string[]
  }>('apply_sheet_instance_composition_adoption', {
    p_instance_id: uuid.parse(input.instanceId),
    p_expected_instance_revision: input.expectedRevision,
    p_target_definition_version_id: uuid.parse(input.targetDefinitionVersionId),
    p_parameter_inputs: input.parameterInputs ?? [],
    p_retry_token: uuid.parse(input.retryToken),
  })
  return {
    status: 'applied',
    idempotent: Boolean(result.idempotent),
    preview: previewSchema.parse(result.preview ?? preview),
    instance: sheetInstanceFromWire(result.instance),
    unmatchedLocalRowKeys: result.unmatchedLocalRowKeys ?? [],
  }
}
