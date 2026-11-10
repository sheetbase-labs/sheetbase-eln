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
import { createDataClient } from './data-client'
import { pipelineJsonObjectSchema } from './pipelines/types'

function client(
  captured: Array<{
    name: string
    args: ReturnType<typeof pipelineJsonObjectSchema.parse>
  }>,
) {
  return createDataClient(async (input, init) => {
    const request = new Request(
      new URL(input instanceof Request ? input.url : input, 'http://localhost'),
      init,
    )

    const name = new URL(request.url).pathname.split('/').at(-1) ?? ''
    const args = pipelineJsonObjectSchema.parse(await request.json())
    captured.push({ name, args })

    if (name === 'create_dataset_schema_definition') {
      return Response.json({
        schema_definition_id: 'def-1',
        schema_version_id: 'ver-1',
      })
    }

    if (name === 'create_next_dataset_schema_version') {
      return Response.json({ schema_version_id: 'ver-2', version: 2 })
    }

    if (name === 'list_capabilities') return Response.json(['schema.edit'])

    if (name === 'replace_dataset_schema_version_fields') {
      return Response.json({
        id: 'ver-1',
        schema_id: 'def-1',
        version: 1,
        revision: 9,
        lifecycle: 'draft',
        published_at: null,
      })
    }

    return Response.json(null)
  })
}

describe('canonical Dataset Schema Definition RPCs', () => {
  it('sends snake_case field contracts to the CORE-02 management RPCs', async () => {
    const captured: Parameters<typeof client>[0] = []
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

  it('sends the revision it read and returns the saved version', async () => {
    const captured: Parameters<typeof client>[0] = []
    const c = client(captured)

    const version = await replaceDatasetSchemaVersionFields(c, {
      schemaVersionId: 'ver-1',
      expectedRevision: 8,
      fields: [{ key: 'titre', label: 'Titre', logicalType: 'decimal' }],
    })

    expect(captured[0]?.args).toMatchObject({ p_expected_revision: 8 })
    expect(version.revision).toBe(9)
    captured.length = 0
    await replaceDatasetSchemaVersionFields(c, {
      schemaVersionId: 'ver-1',
      fields: [{ key: 'titre', label: 'Titre', logicalType: 'decimal' }],
    })
    // A caller with no revision expectation sends NULL; only canonical
    // server-side callers that already hold the row lock do this.
    expect(captured[0]?.args).toMatchObject({ p_expected_revision: null })
  })

  it('lists canonical Dataset Schema identities through PostgREST', async () => {
    const listed: string[] = []

    const c = createDataClient(async (input) => {
      const url = new URL(
        input instanceof Request ? input.url : input,
        'http://localhost',
      )

      listed.push(url.pathname.split('/').at(-1) ?? '')

      return Response.json([])
    })

    await listCanonicalDatasetSchemaDefinitions(c)
    await listCanonicalDatasetSchemaVersions(c, 'def-1')
    await listCanonicalDatasetSchemaVersionFields(c, 'ver-1')
    expect(listed).toEqual([
      'dataset_schema_definitions',
      'dataset_schema_versions',
      'dataset_schema_version_fields',
    ])
  })

  it('decodes persisted metadata without losing scientific keys or adding absent defaults', async () => {
    const scientific = Object.fromEntries([['__proto__', { nested: 7 }]])

    const field = {
      field_id: 'field-1',
      key: 'titre',
      label: 'Titre',
      description: null,
      logical_type: 'decimal',
      nullable: true,
      cardinality: 'one',
      lifecycle: 'active',
      display_order: 1,
      ...scientific,
      validation: { min: 0, ...scientific },
      quantity: {
        kind: 'mass',
        dimension: 'mass',
        storageUnit: 'g',
        ...scientific,
      },
    }

    const c = createDataClient(async () =>
      Response.json([
        field,
        { ...field, field_id: 'field-2', default_value: null },
      ]),
    )

    const result = await listCanonicalDatasetSchemaVersionFields(c, 'ver-1')
    expect(result).toEqual([
      field,
      { ...field, field_id: 'field-2', default_value: null },
    ])
    expect(Object.hasOwn(result[0], '__proto__')).toBe(true)
    expect(Object.hasOwn(result[0].validation ?? {}, '__proto__')).toBe(true)
    expect(Object.hasOwn(result[0].quantity ?? {}, '__proto__')).toBe(true)
    expect(Object.hasOwn(result[0], 'default_value')).toBe(false)
    expect(Object.hasOwn(result[1], 'default_value')).toBe(true)
    expect(Object.getPrototypeOf(result[0])).toBe(Object.prototype)
  })

  it.each([
    { validation: { min: 'zero' } },
    { quantity: { kind: 'mass', dimension: 'mass', storageUnit: 4 } },
  ])('rejects malformed persisted semantic metadata: %j', async (metadata) => {
    const c = createDataClient(async () =>
      Response.json([
        {
          field_id: 'field-1',
          key: 'titre',
          label: 'Titre',
          description: null,
          logical_type: 'decimal',
          nullable: true,
          cardinality: 'one',
          lifecycle: 'active',
          display_order: 1,
          ...metadata,
        },
      ]),
    )

    await expect(
      listCanonicalDatasetSchemaVersionFields(c, 'ver-1'),
    ).rejects.toThrow()
  })
})
