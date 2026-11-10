import { describe, expect, it } from 'vitest'

import { requireBuiltInModel } from './built-in-models'
import { createDataClient } from './data-client'
import { pipelineJsonObjectSchema } from './pipelines/types'
import {
  fetchTypeFields,
  fetchTypedObjects,
  pickableTypes,
  saveNewObjectFields,
  setModelType,
  typeAncestors,
  typeDescendants,
  typeForVersion,
  typeHost,
  typeRoot,
  valuesForType,
} from './model-subtypes'
import type { FieldGroup, ModelType } from './model-subtypes'

function type(
  key: string,
  parentKey: string | null,
  published: string | null = `${key}-v1`,
): ModelType {
  return {
    id: key,
    key,
    name: key,
    prefix: key.slice(0, 3).toUpperCase(),
    parentKey,
    lifecycle: 'active',
    publishedVersionId: published,
    versionIds: published ? [published] : [],
  }
}

const types = [
  type('cell_culture', 'experiment'),
  type('perfusion', 'cell_culture'),
  type('draft_kind', 'experiment', null),
  type('cell_bank', null),
  type('master_bank', 'cell_bank'),
  type('cleanroom', 'project'),
]

function group(modelKey: string, ...names: string[]): FieldGroup {
  return {
    modelKey,
    modelName: modelKey,
    fields: names.map((name) => ({
      id: name,
      modelKey,
      fieldName: name,
      label: `${name} label`,
      description: null,
      displayOrder: 0,
      logicalType: 'text',
      nullable: true,
      defaultValue: undefined,
      unit: null,
      validation: {},
      lifecycle: 'active',
      options: [],
    })),
  }
}

describe('model subtype chains', () => {
  it('walks up to the model at the top, nearest parent first', () => {
    expect(typeAncestors(types, 'perfusion').map((t) => t.key)).toEqual([
      'cell_culture',
    ])
    expect(typeRoot(types, 'perfusion')).toBe('experiment')
    expect(typeRoot(types, 'master_bank')).toBe('cell_bank')
  })

  it('lists every subtype below a model, with its depth', () => {
    expect(
      typeDescendants(types, 'experiment').map((o) => [o.type.key, o.depth]),
    ).toEqual([
      ['cell_culture', 1],
      ['perfusion', 2],
      ['draft_kind', 1],
    ])
    expect(pickableTypes(types, 'experiment').map((o) => o.type.key)).toEqual([
      'cell_culture',
      'perfusion',
    ])
  })

  it('stops on a loop rather than walking forever', () => {
    const looped = [type('a', 'b'), type('b', 'a')]
    expect(typeAncestors(looped, 'a').map((t) => t.key)).toEqual(['b'])
    expect(['a', 'b']).toContain(typeRoot(looped, 'a'))
  })

  it('traces a pinned version back to its type and host', () => {
    expect(typeForVersion(types, 'perfusion-v1')?.key).toBe('perfusion')
    expect(typeForVersion(types, null)).toBeNull()
    expect(typeHost(types, 'cleanroom').host).toBe('project')
    expect(typeHost(types, 'master_bank')).toMatchObject({
      root: 'cell_bank',
      builtIn: null,
      host: 'record',
    })
  })
})

describe('valuesForType', () => {
  it('keeps what the new type has and names what it drops', () => {
    const { kept, dropped } = valuesForType(
      { harvest: 6, cell_line: 'CHO', rate: '' },
      [
        group('experiment', 'harvest'),
        group('cell_culture', 'cell_line', 'rate'),
      ],
      [group('experiment', 'harvest')],
    )

    expect(kept).toEqual({ harvest: 6 })
    expect(dropped).toEqual(['cell_line label'])
  })

  it('keeps own scientific keys without changing the prototype or inventing missing values', () => {
    const scientific = Object.fromEntries([
      ['__proto__', { measurements: [0, false, null] }],
    ])

    const { kept, dropped } = valuesForType(
      { ...scientific, empty: null, blank: '', zero: 0, unchecked: false },
      [group('experiment', '__proto__', 'empty', 'blank', 'zero', 'unchecked')],
      [group('experiment', '__proto__', 'missing')],
    )

    expect(kept).toEqual(scientific)
    expect(Object.hasOwn(kept, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(kept)).toBe(Object.prototype)
    expect(Object.hasOwn(kept, 'missing')).toBe(false)
    expect(dropped).toEqual(['zero label', 'unchecked label'])
  })
})

describe('subtype HTTP transport', () => {
  it('uses ancestor published versions and the own pinned version without adding a default', async () => {
    const versions: string[] = []

    const client = createDataClient(async (input) => {
      const url = new URL(
        input instanceof Request ? input.url : input,
        'http://localhost',
      )

      if (
        url.pathname.endsWith('/record_models') ||
        url.pathname.endsWith('/record_field_definitions')
      )
        return Response.json([])
      const version = url.searchParams.get('id') ?? ''
      versions.push(version)

      const field = {
        id: version,
        field_name: version,
        label: version,
        display_order: 0,
        logical_type: 'text',
        nullable: true,
        unit: null,
        validation: {},
        lifecycle: 'active',
      }

      const fields =
        version === 'eq.cell_culture-v1'
          ? [{ ...field, default_value: null }]
          : [field]

      return Response.json([
        {
          definition: {
            fields,
          },
        },
      ])
    })

    const groups = await fetchTypeFields(
      client,
      types,
      'experiment',
      'perfusion',
      'perfusion-old',
    )

    expect(groups.map((item) => item.modelKey)).toEqual([
      'experiment',
      'cell_culture',
      'perfusion',
    ])
    expect(versions).toEqual(['eq.cell_culture-v1', 'eq.perfusion-old'])
    expect(groups[1]?.fields[0]?.defaultValue).toBeNull()
    expect(groups[2]?.fields[0]?.defaultValue).toBeUndefined()
  })

  it('merges stored fields into a new subtype through the real RPC request', async () => {
    const captured: Array<ReturnType<typeof pipelineJsonObjectSchema.parse>> =
      []

    const scientific = Object.fromEntries([['__proto__', { titre: [1, null] }]])

    const client = createDataClient(async (input, init) => {
      const request = new Request(
        new URL(
          input instanceof Request ? input.url : input,
          'http://localhost',
        ),
        init,
      )

      if (request.method === 'GET')
        return Response.json([
          {
            custom_fields: { ...scientific, inherited: false, rate: 1 },
            locked_at: null,
            model_version_id: null,
          },
        ])
      expect(new URL(request.url).pathname).toBe('/api/db/rpc/set_model_type')
      captured.push(pipelineJsonObjectSchema.parse(await request.json()))

      return Response.json({ identifier: 'PER-001' })
    })

    await expect(
      saveNewObjectFields(
        client,
        requireBuiltInModel('experiment'),
        'object-1',
        'perfusion',
        { rate: 2 },
      ),
    ).resolves.toEqual({ identifier: 'PER-001' })
    expect(captured).toEqual([
      {
        p_host: 'records',
        p_id: 'object-1',
        p_model_key: 'perfusion',
        p_custom_fields: { ...scientific, inherited: false, rate: 2 },
      },
    ])
    expect(
      Object.hasOwn(
        pipelineJsonObjectSchema.parse(captured[0]?.p_custom_fields),
        '__proto__',
      ),
    ).toBe(true)
  })

  it('keeps normal record saves on the metadata-versioned write path', async () => {
    const captured: Array<ReturnType<typeof pipelineJsonObjectSchema.parse>> =
      []

    const client = createDataClient(async (input, init) => {
      const request = new Request(
        new URL(
          input instanceof Request ? input.url : input,
          'http://localhost',
        ),
        init,
      )

      if (request.method === 'GET')
        return Response.json([{ metadata_version: 7, locked_at: null }])
      expect(new URL(request.url).pathname).toBe(
        '/api/db/rpc/update_record_custom_fields',
      )
      captured.push(pipelineJsonObjectSchema.parse(await request.json()))

      return Response.json(null)
    })

    await expect(
      saveNewObjectFields(
        client,
        requireBuiltInModel('experiment'),
        'object-1',
        null,
        { measured: false },
      ),
    ).resolves.toEqual({ identifier: null })
    expect(captured).toEqual([
      {
        p_record_id: 'object-1',
        p_expected_metadata_version: 7,
        p_values: { measured: false },
      },
    ])
  })

  it.each([
    { identifier: 'REC-1', display_id: 'PRJ-1', expected: 'REC-1' },
    { identifier: null, display_id: 'PRJ-1', expected: 'PRJ-1' },
    { identifier: 7, display_id: 'PRJ-1', expected: null },
    { expected: null },
  ])(
    'preserves identifier precedence and missing-value behavior: %j',
    async ({ expected, ...row }) => {
      const client = createDataClient(async () => Response.json(row))
      await expect(
        setModelType(client, 'project', 'object-1', null, {}),
      ).resolves.toEqual({ identifier: expected })
    },
  )

  it('rejects non-finite writes before JSON transport can turn them into null', async () => {
    let requests = 0

    const client = createDataClient(async () => {
      requests += 1

      return Response.json({})
    })

    const invalid = Object.fromEntries([
      ['__proto__', { measurement: Infinity }],
    ])

    await expect(
      setModelType(client, 'record', 'object-1', 'perfusion', invalid),
    ).rejects.toThrow()
    await expect(
      saveNewObjectFields(
        client,
        requireBuiltInModel('experiment'),
        'object-1',
        null,
        invalid,
      ),
    ).rejects.toThrow()
    expect(requests).toBe(0)
  })

  it.each(['project', 'instrument', 'experiment'])(
    'decodes %s object values without losing scientific keys',
    async (root) => {
      const subtype = type('scientific', root)

      const scientific = Object.fromEntries([
        ['__proto__', { nested: [false, 0] }],
      ])

      const client = createDataClient(async (input) => {
        const url = new URL(
          input instanceof Request ? input.url : input,
          'http://localhost',
        )

        expect(url.searchParams.get('model_version_id')).toBe(
          'in.(scientific-v1)',
        )

        return Response.json([
          {
            id: 'object-1',
            identifier: 'REC-1',
            display_id: 'OBJ-1',
            title: 'Object',
            name: 'Object',
            kind: root,
            custom_fields: scientific,
          },
          {
            id: 'object-2',
            identifier: 'REC-2',
            display_id: null,
            title: 'Empty',
            name: 'Empty',
            kind: root,
            custom_fields: null,
          },
        ])
      })

      const result = await fetchTypedObjects(client, [subtype], subtype)
      expect(result.map((item) => item.customFields)).toEqual([scientific, {}])
      expect(Object.hasOwn(result[0]?.customFields ?? {}, '__proto__')).toBe(
        true,
      )
    },
  )

  it.each([
    '[]',
    '"invalid"',
    '7',
    '{"measurement":1e999}',
    '{"__proto__":{"measurement":1e999}}',
  ])('rejects malformed persisted custom fields: %j', async (customFields) => {
    const subtype = type('perfusion', 'experiment')

    const client = createDataClient(
      async () =>
        new Response(
          `[{"id":"object-1","kind":"experiment","custom_fields":${customFields}}]`,
          { headers: { 'content-type': 'application/json' } },
        ),
    )

    await expect(
      fetchTypedObjects(client, [subtype], subtype),
    ).rejects.toThrow()
  })
})
