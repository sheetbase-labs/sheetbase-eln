import { describe, expect, it } from 'vitest'

import {
  createDatasetSchemaDefinition,
  createNextDatasetSchemaVersion,
  listCanonicalDatasetSchemaDefinitions,
  listCanonicalDatasetSchemaVersionFields,
  listCanonicalDatasetSchemaVersions,
  listWorkspaceCapabilities,
  publishDatasetSchemaVersion,
  replaceDatasetSchemaVersionFields,
  retireDatasetSchemaDefinition,
} from './dataset-schema-definition-rpc'
import type { DataClient } from './data-client'

function client(captured: Array<{ name: string; args: unknown }>): DataClient {
  return {
    rpc: async (name, args) => {
      captured.push({ name, args })
      if (name === 'create_dataset_schema_definition') {
        return {
          schema_definition_id: 'def-1',
          schema_version_id: 'ver-1',
        }
      }
      if (name === 'create_next_dataset_schema_version') {
        return { schema_version_id: 'ver-2', version: 2 }
      }
      if (name === 'list_capabilities') return ['schema.edit']
      return undefined
    },
  } as DataClient
}

describe('canonical Dataset Schema Definition RPCs', () => {
  it('sends snake_case field contracts to the CORE-02 management RPCs', async () => {
    const captured: Array<{ name: string; args: unknown }> = []
    const c = client(captured)
    await createDatasetSchemaDefinition(c, {
      workspaceId: 'ws-1',
      key: 'stability_result',
      name: 'Stability result',
      fields: [{ key: 'titre', label: 'Titre', logicalType: 'decimal' }],
    })
    await replaceDatasetSchemaVersionFields(c, {
      schemaVersionId: 'ver-1',
      fields: [{ key: 'titre', label: 'Titre', logicalType: 'decimal' }],
    })
    await publishDatasetSchemaVersion(c, 'ver-1')
    await createNextDatasetSchemaVersion(c, 'def-1')
    await retireDatasetSchemaDefinition(c, 'def-1')
    await listWorkspaceCapabilities(c, 'ws-1')
    expect(captured.map((item) => item.name)).toEqual([
      'create_dataset_schema_definition',
      'replace_dataset_schema_version_fields',
      'publish_dataset_schema_version',
      'create_next_dataset_schema_version',
      'retire_dataset_schema_definition',
      'list_capabilities',
    ])
    expect(captured[0]?.args).toMatchObject({
      p_workspace_id: 'ws-1',
      p_key: 'stability_result',
      p_fields: [{ key: 'titre', logical_type: 'decimal' }],
    })
  })

  it('lists canonical Dataset Schema identities through PostgREST', async () => {
    const listed: string[] = []
    const c = {
      list: async (resource: string) => {
        listed.push(resource)
        return []
      },
    } as DataClient
    await listCanonicalDatasetSchemaDefinitions(c)
    await listCanonicalDatasetSchemaVersions(c, 'def-1')
    await listCanonicalDatasetSchemaVersionFields(c, 'ver-1')
    expect(listed).toEqual([
      'dataset_schema_definitions',
      'dataset_schema_versions',
      'dataset_schema_version_fields',
    ])
  })
})
