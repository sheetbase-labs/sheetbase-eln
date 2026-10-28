import { useQuery } from '@tanstack/react-query'

import type { DataClient } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  fetchModelFields,
  modelFieldValidationForServer,
} from '#/lib/model-fields'
import type {
  ModelFieldDefinition,
  ModelFieldLogicalType,
} from '#/lib/model-fields'
import { fetchAddedFieldValues } from '#/lib/built-in-models'
import type { BuiltInModel } from '#/lib/built-in-models'

export const builtInModelQueryKeys = {
  all: ['ui-port', 'built-in-model'] as const,
  fields: (key: string, includeRetired: boolean) =>
    [
      'ui-port',
      'built-in-model',
      'fields',
      key,
      includeRetired ? 'all' : 'active',
    ] as const,
  takenKeys: (key: string) =>
    ['ui-port', 'built-in-model', 'taken-keys', key] as const,
  values: (key: string, objectId: string) =>
    ['ui-port', 'built-in-model', 'values', key, objectId] as const,
}

/** The fields a workspace added to a built-in model, in display order. */
export function useBuiltInModelFields(
  modelKey: string,
  { includeRetired = false, enabled = true } = {},
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: builtInModelQueryKeys.fields(modelKey, includeRetired),
    queryFn: () => fetchModelFields(client, modelKey, includeRetired),
    enabled: enabled && Boolean(modelKey),
    staleTime: 30_000,
  })
}

/** One object's added-field values (and whether it is locked by a signature). */
export function useAddedFieldValues(
  model: BuiltInModel | undefined,
  objectId: string,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: builtInModelQueryKeys.values(model?.key ?? '', objectId),
    queryFn: () => fetchAddedFieldValues(client, model!, objectId),
    enabled: Boolean(model && objectId),
    staleTime: 15_000,
  })
}

/**
 * Every key the model already uses: its standard columns and every field
 * definition, including drafts and retired ones. A new field's key must avoid
 * all of them.
 */
export function useTakenFieldKeys(
  modelKey: string,
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: builtInModelQueryKeys.takenKeys(modelKey),
    queryFn: async () => {
      const [base, defined] = await Promise.all([
        client.list<{ field_key: string }>(
          'model_base_fields',
          `?model_key=eq.${encodeURIComponent(modelKey)}&select=field_key`,
        ),
        client.list<{ field_name: string }>(
          'record_field_definitions',
          `?kind=eq.${encodeURIComponent(modelKey)}&select=field_name`,
        ),
      ])
      return new Set([
        ...base.map((row) => row.field_key),
        ...defined.map((row) => row.field_name),
      ])
    },
    enabled: Boolean(modelKey),
    staleTime: 15_000,
  })
}

export interface FieldPlacement {
  section: string | null
  askOnCreate: boolean
  showInList: boolean
}

export interface NewBuiltInField extends FieldPlacement {
  workspaceId: string
  modelKey: string
  fieldName: string
  label: string
  description: string | null
  logicalType: Exclude<ModelFieldLogicalType, 'reference'>
  required: boolean
  defaultValue: unknown
  validation: Record<string, unknown>
  unit: string | null
  options: Array<{ key: string; label: string }>
}

/**
 * Add a field: `create_and_activate_model_field` drafts, adds the choices and
 * activates in one transaction (filling the starting value into existing
 * records), then the placement is set. Placement is presentation and stays
 * editable; the type and required-ness are fixed once the field is active.
 */
export async function createBuiltInModelField(
  client: DataClient,
  input: NewBuiltInField,
): Promise<ModelFieldDefinition['id']> {
  const created = await client.rpc<{ id: string }>(
    'create_and_activate_model_field',
    {
      p_workspace_id: input.workspaceId,
      p_model_key: input.modelKey,
      p_field_name: input.fieldName,
      p_label: input.label,
      p_logical_type: input.logicalType,
      p_nullable: !input.required,
      p_default_value: input.defaultValue ?? null,
      p_validation: modelFieldValidationForServer(input.validation),
      p_options: input.options,
      p_unit: input.unit ? { symbol: input.unit } : null,
      p_description: input.description,
    },
  )
  await updateBuiltInModelField(client, created.id, {
    section: input.section,
    askOnCreate: input.askOnCreate,
    showInList: input.showInList,
  })
  return created.id
}

export function updateBuiltInModelField(
  client: DataClient,
  definitionId: string,
  patch: Partial<FieldPlacement> & {
    label?: string
    description?: string | null
  },
): Promise<unknown> {
  return client.rpc('update_model_field', {
    p_definition_id: definitionId,
    p_patch: patch,
  })
}

export function retireBuiltInModelField(
  client: DataClient,
  definitionId: string,
): Promise<unknown> {
  return client.rpc('retire_model_field', { p_definition_id: definitionId })
}

/** The server's refusal in a scientist's words. */
export function describeFieldAuthoringError(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : ''
  const message = error instanceof Error ? error.message : ''
  if (code === '42501')
    return 'Your workspace role can’t change fields. Ask a workspace owner, admin or steward.'
  if (message.includes('needs a default'))
    return 'Records already exist, so a required field needs a starting value to fill them with.'
  if (message.includes('locked records'))
    return 'Some signed records have no value for this field, so it can’t be required. Make it optional instead.'
  if (message.includes('category needs an active option'))
    return 'Add at least one choice.'
  if (code === 'SB070' || message.includes('collision'))
    return 'That name is already used on this model. Choose another name.'
  if (code === 'SB071')
    return 'Some of these settings don’t fit together. Check the starting value and limits.'
  return message || 'Could not save the field.'
}
