import { createDataClient } from './data-client'
import type { DataClient } from './data-client'
import {
  parseSheetDefinitionExtractionPreview,
  parseSheetDefinitionExtractionSelection,
} from './sheet-definition-extraction'
import type {
  SheetDefinitionExtractionPreview,
  SheetDefinitionExtractionSelection,
} from './sheet-definition-extraction'
import { parseSheetDefinitionConfiguration } from './sheet-definition'
import type { SheetDefinitionConfiguration } from './sheet-definition'

export type SheetDefinitionLifecycle = 'active' | 'retired'
export type SheetDefinitionVersionLifecycle = 'draft' | 'published' | 'retired'

export interface SheetDefinitionWire {
  id: string
  workspace_id: string
  key: string
  name: string
  description: string | null
  lifecycle: SheetDefinitionLifecycle
  revision: number | string
  created_at: string
  updated_at: string
  created_by_user_id: string | null
  updated_by_user_id: string | null
}

export interface SheetDefinitionVersionWire {
  id: string
  definition_id: string
  version: number
  lifecycle: SheetDefinitionVersionLifecycle
  configuration_format_version: number
  configuration: unknown
  revision: number | string
  created_at: string
  updated_at: string
  created_by_user_id: string | null
  updated_by_user_id: string | null
  published_at: string | null
  published_by_user_id: string | null
  retired_at: string | null
  retired_by_user_id: string | null
}

export interface SheetDefinition {
  id: string
  workspaceId: string
  key: string
  name: string
  description: string | null
  lifecycle: SheetDefinitionLifecycle
  revision: number
}

export interface SheetDefinitionVersion {
  id: string
  definitionId: string
  version: number
  lifecycle: SheetDefinitionVersionLifecycle
  configuration: SheetDefinitionConfiguration
  revision: number
  publishedAt: string | null
  retiredAt: string | null
}

interface MutationWire {
  definition: SheetDefinitionWire
  version?: SheetDefinitionVersionWire
}

interface ExtractionWire extends MutationWire {
  preview: unknown
}

export const sheetDefinitionDataClient = createDataClient()

export function sheetDefinitionFromWire(
  wire: SheetDefinitionWire,
): SheetDefinition {
  return {
    id: wire.id,
    workspaceId: wire.workspace_id,
    key: wire.key,
    name: wire.name,
    description: wire.description,
    lifecycle: wire.lifecycle,
    revision: Number(wire.revision),
  }
}

export function sheetDefinitionVersionFromWire(
  wire: SheetDefinitionVersionWire,
): SheetDefinitionVersion {
  if (wire.configuration_format_version !== 1) {
    throw new Error(
      `Unsupported Sheet Definition configuration format: ${wire.configuration_format_version}`,
    )
  }
  return {
    id: wire.id,
    definitionId: wire.definition_id,
    version: wire.version,
    lifecycle: wire.lifecycle,
    configuration: parseSheetDefinitionConfiguration(wire.configuration),
    revision: Number(wire.revision),
    publishedAt: wire.published_at,
    retiredAt: wire.retired_at,
  }
}

export async function fetchSheetDefinitions(
  client: DataClient = sheetDefinitionDataClient,
): Promise<SheetDefinition[]> {
  const rows = await client.list<SheetDefinitionWire>(
    'sheet_definitions',
    '?order=created_at.asc,id.asc',
  )
  return rows.map(sheetDefinitionFromWire)
}

export async function fetchSheetDefinitionVersions(
  definitionId: string,
  client: DataClient = sheetDefinitionDataClient,
): Promise<SheetDefinitionVersion[]> {
  const rows = await client.list<SheetDefinitionVersionWire>(
    'sheet_definition_versions',
    `?definition_id=eq.${encodeURIComponent(definitionId)}&order=version.asc`,
  )
  return rows.map(sheetDefinitionVersionFromWire)
}

export async function createSheetDefinition(
  input: {
    workspaceId: string
    key: string
    name: string
    description?: string | null
    configuration: SheetDefinitionConfiguration
  },
  client: DataClient = sheetDefinitionDataClient,
): Promise<{ definition: SheetDefinition; version: SheetDefinitionVersion }> {
  const result = await client.rpc<MutationWire>('create_sheet_definition', {
    p_workspace_id: input.workspaceId,
    p_key: input.key,
    p_name: input.name,
    p_description: input.description ?? null,
    p_configuration: parseSheetDefinitionConfiguration(input.configuration),
  })
  if (!result.version)
    throw new Error('Sheet Definition create returned no version.')
  return {
    definition: sheetDefinitionFromWire(result.definition),
    version: sheetDefinitionVersionFromWire(result.version),
  }
}

export async function updateSheetDefinitionDraft(
  versionId: string,
  expectedRevision: number,
  configuration: SheetDefinitionConfiguration,
  client: DataClient = sheetDefinitionDataClient,
): Promise<SheetDefinitionVersion> {
  const result = await client.rpc<SheetDefinitionVersionWire>(
    'update_sheet_definition_draft',
    {
      p_version_id: versionId,
      p_expected_revision: expectedRevision,
      p_configuration: parseSheetDefinitionConfiguration(configuration),
    },
  )
  return sheetDefinitionVersionFromWire(result)
}

export async function createSheetDefinitionVersion(
  definitionId: string,
  expectedDefinitionRevision: number,
  configuration: SheetDefinitionConfiguration,
  client: DataClient = sheetDefinitionDataClient,
): Promise<SheetDefinitionVersion> {
  const result = await client.rpc<SheetDefinitionVersionWire>(
    'create_sheet_definition_version',
    {
      p_definition_id: definitionId,
      p_expected_definition_revision: expectedDefinitionRevision,
      p_configuration: parseSheetDefinitionConfiguration(configuration),
    },
  )
  return sheetDefinitionVersionFromWire(result)
}

export async function updateSheetDefinition(
  definitionId: string,
  expectedRevision: number,
  patch: { name?: string; description?: string | null },
  client: DataClient = sheetDefinitionDataClient,
): Promise<SheetDefinition> {
  const result = await client.rpc<SheetDefinitionWire>(
    'update_sheet_definition',
    {
      p_definition_id: definitionId,
      p_expected_revision: expectedRevision,
      p_patch: patch,
    },
  )
  return sheetDefinitionFromWire(result)
}

export async function publishSheetDefinitionVersion(
  versionId: string,
  expectedRevision: number,
  client: DataClient = sheetDefinitionDataClient,
): Promise<SheetDefinitionVersion> {
  const result = await client.rpc<SheetDefinitionVersionWire>(
    'publish_sheet_definition_version',
    { p_version_id: versionId, p_expected_revision: expectedRevision },
  )
  return sheetDefinitionVersionFromWire(result)
}

export async function retireSheetDefinition(
  definitionId: string,
  expectedRevision: number,
  client: DataClient = sheetDefinitionDataClient,
): Promise<SheetDefinition> {
  const result = await client.rpc<SheetDefinitionWire>(
    'retire_sheet_definition',
    {
      p_definition_id: definitionId,
      p_expected_revision: expectedRevision,
    },
  )
  return sheetDefinitionFromWire(result)
}

export async function retireSheetDefinitionVersion(
  versionId: string,
  expectedRevision: number,
  client: DataClient = sheetDefinitionDataClient,
): Promise<SheetDefinitionVersion> {
  const result = await client.rpc<SheetDefinitionVersionWire>(
    'retire_sheet_definition_version',
    { p_version_id: versionId, p_expected_revision: expectedRevision },
  )
  return sheetDefinitionVersionFromWire(result)
}

export async function previewSheetDefinitionExtraction(
  instanceId: string,
  expectedInstanceRevision: number,
  selection: SheetDefinitionExtractionSelection,
  client: DataClient = sheetDefinitionDataClient,
): Promise<SheetDefinitionExtractionPreview> {
  const result = await client.rpc<unknown>(
    'preview_sheet_definition_extraction',
    {
      p_instance_id: instanceId,
      p_expected_instance_revision: expectedInstanceRevision,
      p_selection: parseSheetDefinitionExtractionSelection(selection),
    },
  )
  return parseSheetDefinitionExtractionPreview(result)
}

export async function extractSheetDefinitionDraft(
  input: {
    instanceId: string
    expectedInstanceRevision: number
    key: string
    name: string
    description?: string | null
    selection: SheetDefinitionExtractionSelection
  },
  client: DataClient = sheetDefinitionDataClient,
): Promise<{
  definition: SheetDefinition
  version: SheetDefinitionVersion
  preview: SheetDefinitionExtractionPreview
}> {
  const result = await client.rpc<ExtractionWire>(
    'extract_sheet_definition_draft',
    {
      p_instance_id: input.instanceId,
      p_expected_instance_revision: input.expectedInstanceRevision,
      p_key: input.key,
      p_name: input.name,
      p_description: input.description ?? null,
      p_selection: parseSheetDefinitionExtractionSelection(input.selection),
    },
  )
  if (!result.version)
    throw new Error('Sheet Definition extraction returned no draft version.')
  return {
    definition: sheetDefinitionFromWire(result.definition),
    version: sheetDefinitionVersionFromWire(result.version),
    preview: parseSheetDefinitionExtractionPreview(result.preview),
  }
}
