import { describe, expect, it } from 'vitest'

import { createDataClient } from './data-client'
import type { DataClient } from './data-client'
import type { PipelineDefinitionVersionWire } from './pipelines/types'
import { plainTextToRichText } from './blocks/plain-text'
import { buildAssistantProposal } from './assistant-proposals.server'
import { proposalToolDefs } from './assistant-proposals'

const RECORD = '11111111-1111-4111-8111-111111111111'
const BLOCK = '22222222-2222-4222-8222-222222222222'
const WORKSPACE = '33333333-3333-4333-8333-333333333333'

const recordRow = {
  id: RECORD,
  workspace_id: WORKSPACE,
  project_id: null,
  folder_id: null,
  kind: 'experiment',
  identifier: 'EXP-12',
  title: 'Buffer screen',
  status: 'draft',
  tags: [],
  structure_version: 7,
  metadata_version: 4,
  created_at: '',
  updated_at: '',
  archived_at: null,
  deleted_at: null,
  created_by_user_id: 'u',
  updated_by_user_id: null,
  properties: {},
  custom_fields: { organism: 'E. coli' },
  locked_at: null,
  locked_by_revision_id: null,
}

function client(): DataClient {
  return createDataClient(async (input) => {
    const url = new URL(
      input instanceof Request ? input.url : input,
      'http://app.test',
    )

    if (url.pathname === '/api/db/records') return Response.json([recordRow])

    if (url.pathname === '/api/db/blocks')
      return Response.json([
        {
          id: BLOCK,
          record_id: RECORD,
          type: 'rich_text',
          payload: plainTextToRichText('Old aim'),
          payload_schema_version: 1,
          order: 1,
          version: 3,
        },
      ])

    return Response.json([])
  })
}

describe('buildAssistantProposal', () => {
  it('builds an insert against the record’s current structure version', async () => {
    const built = await buildAssistantProposal(
      client(),
      WORKSPACE,
      'sheetbase.notebook_block.insert',
      {
        title: 'Add aim',
        summary: 'Adds the aim.',
        recordId: RECORD,
        text: 'Test the buffer.',
      },
    )

    expect(built.ok).toBe(true)

    if (!built.ok) return
    expect(built.proposal.operation).toMatchObject({
      kind: 'notebook_block.insert',
      recordId: RECORD,
      expectedRevision: 7,
    })
    expect(built.proposal.target).toBe('EXP-12 · Buffer screen')
    expect(built.proposal.changes[0]?.before).toBeNull()
  })

  it('shows the old and new text for a block update with its version', async () => {
    const built = await buildAssistantProposal(
      client(),
      WORKSPACE,
      'sheetbase.notebook_block.update',
      {
        title: 'Reword aim',
        summary: 'Clearer aim.',
        blockId: BLOCK,
        text: 'New aim',
      },
    )

    expect(built.ok).toBe(true)

    if (!built.ok) return
    expect(built.proposal.changes[0]).toMatchObject({
      before: 'Old aim',
      after: 'New aim',
    })
    expect(built.proposal.operation).toMatchObject({
      kind: 'notebook_block.update',
      expectedVersion: 3,
    })
  })

  it('shows the old value for a field change', async () => {
    const built = await buildAssistantProposal(
      client(),
      WORKSPACE,
      'sheetbase.record.custom_fields.update',
      {
        title: 'Set organism',
        summary: 'Fix the organism.',
        recordId: RECORD,
        values: { organism: 'B. subtilis' },
      },
    )

    expect(built.ok && built.proposal.changes[0]).toMatchObject({
      label: 'organism',
      before: 'E. coli',
      after: 'B. subtilis',
    })
    expect(built.ok && built.proposal.operation).toMatchObject({
      expectedMetadataVersion: 4,
    })
  })

  it('refuses bad arguments and unknown tools with a message', async () => {
    const bad = await buildAssistantProposal(
      client(),
      WORKSPACE,
      'sheetbase.notebook_block.insert',
      {
        title: 'x',
        summary: 'y',
        recordId: 'not-a-uuid',
        text: 'z',
      },
    )

    expect(bad.ok).toBe(false)

    const unknown = await buildAssistantProposal(
      client(),
      WORKSPACE,
      'sheetbase.signature.sign',
      {},
    )

    expect(unknown).toEqual({
      ok: false,
      message: 'That tool is not available.',
    })
  })

  it('offers the proposal tools to the model', () => {
    expect(proposalToolDefs().map((def) => def.name)).toEqual([
      'sheetbase__notebook_block__insert',
      'sheetbase__notebook_block__update',
      'sheetbase__record__custom_fields__update',
      'sheetbase__sheet_instance__update',
      'sheetbase__pipeline_definition__draft',
      'sheetbase__pipeline_definition__update_draft',
    ])
  })
})

const PIPELINE = '44444444-4444-4444-8444-444444444444'
const DRAFT = '55555555-5555-4555-8555-555555555555'

function pipelineClient(
  versions: Pick<
    PipelineDefinitionVersionWire,
    'id' | 'lifecycle' | 'revision' | 'configuration'
  >[],
  lifecycle = 'active',
): DataClient {
  return createDataClient(async (input) => {
    const url = new URL(
      input instanceof Request ? input.url : input,
      'http://app.test',
    )

    if (url.pathname === '/api/db/pipeline_definitions')
      return Response.json([
        {
          id: PIPELINE,
          workspace_id: WORKSPACE,
          key: 'clean_plate',
          display_id: 'PL-0007',
          name: 'Clean plate reads',
          description: null,
          lifecycle,
          revision: 5,
        },
      ])

    if (url.pathname === '/api/db/pipeline_definition_versions')
      return Response.json(versions)

    return Response.json([])
  })
}

const baseConfig = {
  configVersion: 2,
  mode: 'standard',
  parameters: [],
  inputs: [{ name: 'raw', required: true }],
  steps: [
    { name: 'analysis', kind: 'sql', statement: 'select * from raw' },
    {
      name: 'drop_blanks',
      kind: 'sql',
      statement: 'select * from previous',
    },
  ],
  output: { mode: 'none', datasetLabel: '' },
}

describe('pipeline proposals', () => {
  it('proposes a new pipeline and its first draft in one card', async () => {
    const built = await buildAssistantProposal(
      client(),
      WORKSPACE,
      'sheetbase.pipeline_definition.draft',
      {
        title: 'Clean plate reads',
        summary: 'Drops blank wells.',
        key: 'clean_plate',
        name: 'Clean plate reads',
        inputs: [{ name: 'raw' }],
        statement: 'select * from raw where signal is not null',
        steps: [{ name: 'rank', statement: 'select * from previous' }],
      },
    )

    expect(built.ok).toBe(true)
    const proposal = built.ok ? built.proposal : null
    expect(proposal?.operation).toMatchObject({
      kind: 'pipeline_definition.create',
      key: 'clean_plate',
    })
    expect(proposal?.followUp).toMatchObject({
      kind: 'pipeline_definition.create_version',
      configuration: {
        configVersion: 2,
        mode: 'standard',
        inputs: [{ name: 'raw', required: true }],
        steps: [
          { name: 'analysis', kind: 'sql' },
          { name: 'rank', kind: 'sql' },
        ],
      },
    })
    expect(proposal?.changes.map((change) => change.label)).toEqual([
      'Pipeline',
      'First step',
      'Step · rank',
      'Inputs',
    ])
  })

  it('refuses a pipeline whose SQL steps are not valid', async () => {
    const built = await buildAssistantProposal(
      client(),
      WORKSPACE,
      'sheetbase.pipeline_definition.draft',
      {
        title: 'x',
        summary: 'y',
        key: 'bad',
        name: 'Bad',
        statement: 'select 1',
        steps: [
          { name: 'same', statement: 'select 1' },
          { name: 'same', statement: 'select 2' },
        ],
      },
    )

    expect(built.ok).toBe(false)
  })

  it('edits the draft version and shows only the steps that change', async () => {
    const built = await buildAssistantProposal(
      pipelineClient([
        {
          id: DRAFT,
          lifecycle: 'draft',
          revision: 3,
          configuration: baseConfig,
        },
      ]),
      WORKSPACE,
      'sheetbase.pipeline_definition.update_draft',
      {
        pipelineId: PIPELINE,
        title: 'Tighten the filter',
        summary: 'Filters on signal.',
        statement: 'select * from raw where signal > 0',
      },
    )

    expect(built.ok && built.proposal.operation).toMatchObject({
      kind: 'pipeline_definition.update_draft',
      versionId: DRAFT,
      expectedRevision: 3,
      configuration: {
        steps: [
          { name: 'analysis', statement: 'select * from raw where signal > 0' },
          { name: 'drop_blanks' },
        ],
      },
    })
    expect(built.ok && built.proposal.changes).toEqual([
      {
        label: 'First step',
        before: 'select * from raw',
        after: 'select * from raw where signal > 0',
      },
    ])
    expect(built.ok && built.proposal.target).toContain('PL-0007')
  })

  it('starts a new draft from the published version when there is no draft', async () => {
    const built = await buildAssistantProposal(
      pipelineClient([
        {
          id: DRAFT,
          lifecycle: 'published',
          revision: 9,
          configuration: baseConfig,
        },
      ]),
      WORKSPACE,
      'sheetbase.pipeline_definition.update_draft',
      {
        pipelineId: PIPELINE,
        title: 'Remove a step',
        summary: 'Drops the blank filter.',
        steps: [],
      },
    )

    expect(built.ok && built.proposal.operation).toMatchObject({
      kind: 'pipeline_definition.create_version',
      definitionId: PIPELINE,
      expectedDefinitionRevision: 5,
    })
    expect(built.ok && built.proposal.changes).toEqual([
      {
        label: 'Step · drop_blanks',
        before: 'select * from previous',
        after: '(removed)',
      },
    ])
  })

  it('adds a plugin step between steps and shows it on the card', async () => {
    const built = await buildAssistantProposal(
      pipelineClient([
        {
          id: DRAFT,
          lifecycle: 'draft',
          revision: 3,
          configuration: baseConfig,
        },
      ]),
      WORKSPACE,
      'sheetbase.pipeline_definition.update_draft',
      {
        pipelineId: PIPELINE,
        title: 'Join the plates',
        summary: 'Adds a plugin step.',
        steps: [
          { name: 'drop_blanks', statement: 'select * from previous' },
          {
            name: 'join_plates',
            plugin: {
              operation: 'plugin.plate-tools.join',
              arguments: {
                left: { $ref: 'previous' },
                columns: JSON.parse('{"__proto__":"sample label","x":1}'),
              },
            },
          },
        ],
      },
    )

    expect(built.ok && built.proposal.operation).toMatchObject({
      configuration: {
        steps: [
          { name: 'analysis', kind: 'sql' },
          { name: 'drop_blanks', kind: 'sql' },
          {
            name: 'join_plates',
            kind: 'plugin',
            plugin: {
              operation: 'plugin.plate-tools.join',
              arguments: {
                columns: JSON.parse('{"__proto__":"sample label","x":1}'),
              },
            },
          },
        ],
      },
    })
    expect(built.ok && built.proposal.changes).toEqual([
      {
        label: 'Step · join_plates',
        before: null,
        after: expect.stringContaining('plugin.plate-tools.join'),
      },
    ])
  })

  it('refuses non-finite plugin data hidden under an own __proto__ key', async () => {
    const built = await buildAssistantProposal(
      pipelineClient([]),
      WORKSPACE,
      'sheetbase.pipeline_definition.draft',
      {
        title: 'Join plates',
        summary: 'Adds a plugin step.',
        key: 'plate_join',
        name: 'Plate join',
        statement: 'select 1',
        steps: [
          {
            name: 'join_plates',
            plugin: {
              operation: 'plugin.plate-tools.join',
              arguments: JSON.parse('{"__proto__":{"dose":1e400}}'),
            },
          },
        ],
      },
    )

    expect(built).toMatchObject({
      ok: false,
      message: expect.stringContaining('not valid'),
    })
  })

  it('refuses non-finite parameter defaults hidden under a scientific key', async () => {
    const built = await buildAssistantProposal(
      pipelineClient([]),
      WORKSPACE,
      'sheetbase.pipeline_definition.draft',
      {
        title: 'Threshold',
        summary: 'Adds a threshold.',
        key: 'threshold',
        name: 'Threshold',
        statement: 'select 1',
        parameters: [
          {
            name: 'cutoff',
            type: 'decimal',
            default: JSON.parse('{"__proto__":{"dose":1e400}}'),
          },
        ],
      },
    )

    expect(built).toMatchObject({
      ok: false,
      message: expect.stringContaining('not valid'),
    })
  })

  it('refuses a step that is both SQL and a plugin', async () => {
    const built = await buildAssistantProposal(
      pipelineClient([]),
      WORKSPACE,
      'sheetbase.pipeline_definition.draft',
      {
        title: 't',
        summary: 's',
        name: 'x',
        statement: 'select 1',
        steps: [
          {
            name: 'both',
            statement: 'select 1',
            plugin: { operation: 'plugin.a.b', arguments: {} },
          },
        ],
      },
    )

    expect(built.ok).toBe(false)
  })

  it('edits a draft that lacks empty parameter and input lists', async () => {
    const { parameters: _p, inputs: _i, ...bare } = baseConfig

    const built = await buildAssistantProposal(
      pipelineClient([
        { id: DRAFT, lifecycle: 'draft', revision: 1, configuration: bare },
      ]),
      WORKSPACE,
      'sheetbase.pipeline_definition.update_draft',
      {
        pipelineId: PIPELINE,
        title: 'x',
        summary: 'y',
        statement: 'select * from raw where signal > 0',
      },
    )

    expect(built.ok && built.proposal.changes).toHaveLength(1)
  })

  it('keeps a Python step’s language when its code is changed', async () => {
    const python = {
      ...baseConfig,
      pythonRuntime: `python:3.12@sha256:${'a'.repeat(64)}`,
      steps: [
        baseConfig.steps[0],
        {
          name: 'fit',
          kind: 'python',
          statement: 'def transform(inputs, parameters):\n  return inputs',
        },
      ],
    }

    const built = await buildAssistantProposal(
      pipelineClient([
        { id: DRAFT, lifecycle: 'draft', revision: 1, configuration: python },
      ]),
      WORKSPACE,
      'sheetbase.pipeline_definition.update_draft',
      {
        pipelineId: PIPELINE,
        title: 'x',
        summary: 'y',
        steps: [{ name: 'fit', statement: 'def transform(i, p):\n  return i' }],
      },
    )

    expect(built.ok && built.proposal.operation).toMatchObject({
      configuration: {
        steps: [{ name: 'analysis' }, { name: 'fit', kind: 'python' }],
      },
    })
  })

  it('refuses a retired pipeline, a missing pipeline and a no-op', async () => {
    const args = { title: 'x', summary: 'y', statement: 'select * from raw' }

    const versions: Parameters<typeof pipelineClient>[0] = [
      { id: DRAFT, lifecycle: 'draft', revision: 1, configuration: baseConfig },
    ]

    const retired = await buildAssistantProposal(
      pipelineClient(versions, 'retired'),
      WORKSPACE,
      'sheetbase.pipeline_definition.update_draft',
      { ...args, pipelineId: PIPELINE },
    )

    expect(retired).toEqual({ ok: false, message: 'That pipeline is retired.' })

    const missing = await buildAssistantProposal(
      client(),
      WORKSPACE,
      'sheetbase.pipeline_definition.update_draft',
      { ...args, pipelineId: PIPELINE },
    )

    expect(missing).toEqual({
      ok: false,
      message: 'That pipeline was not found.',
    })

    const same = await buildAssistantProposal(
      pipelineClient(versions),
      WORKSPACE,
      'sheetbase.pipeline_definition.update_draft',
      { ...args, pipelineId: PIPELINE },
    )

    expect(same).toEqual({
      ok: false,
      message: 'That would not change anything.',
    })
  })
})
