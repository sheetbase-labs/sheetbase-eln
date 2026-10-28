import { useQuery } from '@tanstack/react-query'

import type { DataClient } from '#/lib/data-client'
import { DataClientError } from '#/lib/data-client'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  fetchModelTypes,
  fetchTypeFields,
  pickableTypes,
} from '#/lib/model-subtypes'
import type { ModelType } from '#/lib/model-subtypes'

export const modelTypeQueryKeys = {
  all: ['ui-port', 'model-types'] as const,
  fields: (rootKey: string, typeKey: string | null, pinned: string | null) =>
    ['ui-port', 'model-types', 'fields', rootKey, typeKey, pinned] as const,
}

/** Every workspace record type with its parent, for subtype lookups. */
export function useModelTypes(client: DataClient = notebookDataClient) {
  return useQuery({
    queryKey: modelTypeQueryKeys.all,
    queryFn: () => fetchModelTypes(client),
    staleTime: 30_000,
  })
}

/** The published subtypes an object of `rootKey` can be given. */
export function usePickableTypes(rootKey: string) {
  const types = useModelTypes()
  return {
    types: types.data ?? [],
    options: types.data ? pickableTypes(types.data, rootKey) : [],
    isLoading: types.isLoading,
  }
}

/** The fields an object of `typeKey` carries, grouped by the model they come
 * from, top of the chain first. */
export function useTypeFields(
  types: readonly ModelType[] | undefined,
  rootKey: string,
  typeKey: string | null,
  pinnedVersionId: string | null = null,
  { enabled = true }: { enabled?: boolean } = {},
  client: DataClient = notebookDataClient,
) {
  return useQuery({
    queryKey: modelTypeQueryKeys.fields(rootKey, typeKey, pinnedVersionId),
    queryFn: () =>
      fetchTypeFields(client, types ?? [], rootKey, typeKey, pinnedVersionId),
    enabled: enabled && Boolean(types) && Boolean(rootKey),
    staleTime: 30_000,
  })
}

export interface NewSubtype {
  workspaceId: string
  parentKey: string
  key: string
  name: string
  prefix: string
  description: string | null
}

export function createModelSubtype(
  client: DataClient,
  input: NewSubtype,
): Promise<{ id: string; key: string }> {
  return client.rpc('create_model_subtype', {
    p_workspace_id: input.workspaceId,
    p_parent_key: input.parentKey,
    p_key: input.key,
    p_name: input.name,
    p_identifier_prefix: input.prefix,
    p_description: input.description,
  })
}

export function reparentRecordModel(
  client: DataClient,
  modelId: string,
  parentKey: string | null,
): Promise<unknown> {
  return client.rpc('reparent_record_model', {
    p_model_id: modelId,
    p_parent_key: parentKey,
  })
}

/** A refused subtype or type change, in a scientist's words. */
export function describeTypeError(error: unknown): string {
  const code = error instanceof DataClientError ? error.code : undefined
  const message = error instanceof Error ? error.message : ''
  if (code === '42501' || /capability|permission/i.test(message))
    return 'Your workspace role can’t do this. Ask a workspace owner, admin or steward.'
  if (code === 'SB011')
    return /signed records would/.test(message)
      ? `${message.replace(/ would change type.*/, '')} would change type. Signed records keep their type, so this type can’t move.`
      : 'This is signed, so its type can’t change.'
  if (code === 'SB082')
    return /prefix/i.test(message)
      ? 'That ID prefix is already used. Pick another.'
      : /field/i.test(message)
        ? 'A field name clashes with one the new parent already has.'
        : 'That name or ID prefix is already used in this workspace.'
  if (code === 'SB108')
    return 'That type has no published version yet. Publish it first.'
  if (code === 'SB071' && /can't move|can’t move/.test(message))
    return message.replace(/can't move/, 'can’t move')
  if (code === 'SB071' && /own subtype/.test(message))
    return 'A type can’t sit under one of its own subtypes.'
  if (code === 'SB070' && /only move within records/.test(message))
    return 'Types that already have records can only move under another record type.'
  if (code === 'SB071' || code === 'SB070')
    return 'Some of the values don’t fit the new type. Check the required fields.'
  return message || 'Could not change the type.'
}
