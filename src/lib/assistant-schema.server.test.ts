import { describe, expect, it, vi } from 'vitest'

import {
  LINK_RULE_SET_TOOL,
  MODEL_ADD_SUBTYPE_TOOL,
  MODEL_VERSION_PUBLISH_TOOL,
  MODELS_READ_TOOL,
  OPTION_ADD_TOOL,
  RULE_ADD_TOOL,
  SCHEMA_PROPOSE_TOOL_NAMES,
  SCHEMA_READ_TOOL_NAMES,
  SHEET_DEFINITION_RETIRE_TOOL,
  isSchemaAction,
  keyFromName,
} from './assistant-schema'
import type { SchemaAction } from './assistant-schema'
import { runSchemaAction } from './assistant-schema-run'
import {
  buildSchemaProposal,
  isSchemaProposalTool,
  runSchemaReadTool,
  schemaProposalDefs,
} from './assistant-schema.server'
import {
  ASSISTANT_PROPOSE_TOOL_NAMES,
  ASSISTANT_READ_TOOL_NAMES,
} from './agent-tool-catalogue'
import type { LabToolContext } from './assistant-lab-tools.server'
import type { DataClient } from './data-client'

const REAGENT = {
  id: '11111111-1111-4111-8111-111111111111',
  key: 'reagent',
  name: 'Reagent',
  identifier_prefix: 'RGT',
  parent_key: null,
  lifecycle: 'active',
  is_registry: false,
}

const CELL_LINE = {
  ...REAGENT,
  id: '22222222-2222-4222-8222-222222222222',
  key: 'cell_line',
  name: 'Cell line',
  identifier_prefix: 'CL',
}

const STATE = {
  id: '33333333-3333-4333-8333-333333333333',
  field_name: 'state',
  label: 'State',
  logical_type: 'category',
  lifecycle: 'active',
}

const PASSAGE = {
  ...STATE,
  id: '44444444-4444-4444-8444-444444444444',
  field_name: 'passage',
  label: 'Passage',
  logical_type: 'integer',
}

function context(
  tables: Partial<Record<string, (query: string) => unknown[]>>,
) {
  const client = {
    list: (resource: string, query: string) =>
      Promise.resolve(tables[resource]?.(query) ?? []),
    rpc: vi.fn(() => Promise.resolve({})),
  } as unknown as DataClient

  return {
    client,
    workspaceId: 'ws',
    userId: 'u',
    timeZone: 'UTC',
  } satisfies LabToolContext
}

const models = (query: string) =>
  [REAGENT, CELL_LINE].filter(
    (m) =>
      query.includes(`*${m.key.split('_')[0]}`) ||
      query.includes(`*${m.name.split(' ')[0]}`) ||
      query.includes(`key=eq.${m.key}`),
  )

const base = { title: 'Change it', summary: 'As asked' }

describe('record type, sheet definition and template assistant tools', () => {
  it('lists every tool with the agent catalogue and the model', () => {
    for (const name of SCHEMA_PROPOSE_TOOL_NAMES) {
      expect(ASSISTANT_PROPOSE_TOOL_NAMES).toContain(name)
      expect(isSchemaProposalTool(name)).toBe(true)
    }

    for (const name of SCHEMA_READ_TOOL_NAMES)
      expect(ASSISTANT_READ_TOOL_NAMES).toContain(name)
    expect(schemaProposalDefs()).toHaveLength(SCHEMA_PROPOSE_TOOL_NAMES.length)
  })

  it('makes a key from a name', () => {
    expect(keyFromName('Cell line')).toBe('cell_line')
    expect(keyFromName('2D culture')).toBe('x_2d_culture')
  })

  it('proposes a kind of a record type under its parent', async () => {
    const built = await buildSchemaProposal(
      MODEL_ADD_SUBTYPE_TOOL,
      { ...base, name: 'Antibody', prefix: 'AB', parent: 'Reagent' },
      context({
        record_models: (q) => (q.includes('key=eq.antibody') ? [] : models(q)),
      }),
    )

    expect(built.ok).toBe(true)

    if (!built.ok) return
    expect(built.proposal.action).toEqual({
      kind: 'schema.model_create',
      workspaceId: 'ws',
      parentKey: 'reagent',
      key: 'antibody',
      name: 'Antibody',
      prefix: 'AB',
      description: null,
    })
    expect(isSchemaAction(built.proposal.action ?? { kind: '' })).toBe(true)
  })

  it('refuses a choice on a field that has none', async () => {
    const built = await buildSchemaProposal(
      OPTION_ADD_TOOL,
      { ...base, model: 'Cell line', field: 'Passage', label: 'Frozen' },
      context({
        record_models: models,
        record_field_definitions: () => [PASSAGE],
      }),
    )

    expect(built).toEqual({
      ok: false,
      message: 'Passage is not a field with choices.',
    })
  })

  it('adds a choice at the end of the list', async () => {
    const built = await buildSchemaProposal(
      OPTION_ADD_TOOL,
      { ...base, model: 'Cell line', field: 'State', label: 'Thawed' },
      context({
        record_models: models,
        record_field_definitions: () => [STATE],
        model_field_options: () => [
          {
            id: 'o1',
            key: 'frozen',
            label: 'Frozen',
            display_order: 3,
            lifecycle: 'active',
          },
        ],
      }),
    )

    expect(built.ok && built.proposal.action).toEqual({
      kind: 'schema.option_add',
      fieldId: STATE.id,
      key: 'thawed',
      label: 'Thawed',
      order: 4,
    })
  })

  it('proposes a rule on the fields it names', async () => {
    const built = await buildSchemaProposal(
      RULE_ADD_TOOL,
      {
        ...base,
        model: 'Cell line',
        name: 'Passage under 30',
        fields: ['Passage'],
        condition: { field: 'passage', op: 'gt', value: 30 },
        effect: 'warn',
        message: 'Passage is over 30',
      },
      context({
        record_models: models,
        record_field_definitions: () => [PASSAGE],
      }),
    )

    expect(built.ok).toBe(true)

    if (!built.ok) return
    expect(built.proposal.action).toMatchObject({
      kind: 'schema.rule_add',
      modelKey: 'cell_line',
      fieldKeys: ['passage'],
      effect: 'warn',
    })
    expect(built.proposal.changes.map((c) => c.after)).toContain('Warns')
  })

  it('sets a link rule with its limits', async () => {
    const built = await buildSchemaProposal(
      LINK_RULE_SET_TOOL,
      {
        ...base,
        from: 'Cell line',
        to: 'Reagent',
        linkType: 'material',
        min: 1,
        max: 1,
      },
      context({ record_models: models }),
    )

    expect(built.ok && built.proposal.changes[1]).toEqual({
      label: 'How many',
      before: null,
      after: 'exactly 1',
    })
  })

  it('publishes only a draft version', async () => {
    const none = await buildSchemaProposal(
      MODEL_VERSION_PUBLISH_TOOL,
      { ...base, model: 'Cell line' },
      context({
        record_models: models,
        record_model_versions: () => [
          { id: 'v1', version: 1, lifecycle: 'published', revision: 1 },
        ],
      }),
    )

    expect(none).toEqual({
      ok: false,
      message: 'Cell line has no draft to publish.',
    })

    const draft = await buildSchemaProposal(
      MODEL_VERSION_PUBLISH_TOOL,
      { ...base, model: 'Cell line' },
      context({
        record_models: models,
        record_model_versions: () => [
          { id: 'v2', version: 2, lifecycle: 'draft', revision: 1 },
          { id: 'v1', version: 1, lifecycle: 'published', revision: 1 },
        ],
      }),
    )

    expect(draft.ok && draft.proposal.action).toEqual({
      kind: 'schema.model_version_publish',
      versionId: 'v2',
    })
  })

  it('does not retire a sheet definition twice', async () => {
    const built = await buildSchemaProposal(
      SHEET_DEFINITION_RETIRE_TOOL,
      { ...base, definition: 'Growth' },
      context({
        sheet_definitions: () => [
          {
            id: 'd1',
            key: 'growth',
            name: 'Growth',
            lifecycle: 'retired',
            revision: 4,
          },
        ],
      }),
    )

    expect(built).toEqual({ ok: false, message: 'Growth is already retired.' })
  })

  it('reads one record type with its choices and rules', async () => {
    const read = await runSchemaReadTool(
      MODELS_READ_TOOL,
      { model: 'Cell line' },
      context({
        record_models: models,
        record_field_definitions: () => [STATE, PASSAGE],
        model_field_options: () => [
          {
            id: 'o1',
            key: 'frozen',
            label: 'Frozen',
            display_order: 1,
            lifecycle: 'active',
          },
        ],
        model_rules: () => [],
        model_relationship_rules: () => [],
        record_model_versions: () => [],
      }),
    )

    expect(read.isError).toBe(false)

    const body = JSON.parse(read.text) as {
      fields: Array<{ label: string; choices?: string[] }>
    }

    expect(body.fields[0]).toMatchObject({
      label: 'State',
      choices: ['Frozen'],
    })
    expect(body.fields[1].choices).toBeUndefined()
  })

  it('runs each card through its own call', async () => {
    const rpc = vi.fn(() => Promise.resolve({}))
    const client = { rpc } as unknown as DataClient
    const run = (action: SchemaAction) => runSchemaAction(client, action)
    await run({
      kind: 'schema.model_create',
      workspaceId: 'ws',
      parentKey: null,
      key: 'strain',
      name: 'Strain',
      prefix: 'STR',
      description: null,
    })
    await run({
      kind: 'schema.sheet_definition_lifecycle',
      definitionId: 'd1',
      revision: 2,
      retire: false,
    })
    expect(rpc.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
      'create_workspace_model',
      'restore_sheet_definition',
    ])
  })
})
