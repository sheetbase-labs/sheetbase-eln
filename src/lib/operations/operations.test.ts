import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  AGENT_OPERATION_TOOL_NAMES,
  ASSISTANT_PROPOSE_TOOL_NAMES,
} from '../agent-tool-catalogue'
import { EVENT_CATALOGUE } from '../event-catalogue'
import { EXTERNAL_RPC_SCOPES } from '../external-token'
import { LAB_RPCS } from '../lab-api-surface'
import { PIPELINE_ACTIONS, validatePipelineActions } from '../pipelines/actions'
import {
  assistantToolsFrom,
  defineOperation,
  eventEntriesFrom,
  input,
  labRpcsFromOperations,
  operationDocStub,
  pipelineActionsFrom,
} from './descriptor'
import {
  CORE_OPERATIONS,
  agentOperationToolNames,
  assistantProposeToolNames,
  findOperation,
  listOperations,
  pipelineActions,
  registerOperations,
  unregisterOperations,
  validateOperation,
} from './registry'

/** What adding an operation takes: this declaration and its SQL function. */
const SAMPLE = defineOperation({
  name: 'rename_freezer',
  label: 'Rename a freezer',
  summary: 'Rename a freezer',
  description: 'Gives a freezer a new name. Returns the freezer.',
  kind: 'write',
  inputs: [
    input('p_freezer_id', 'uuid'),
    input('p_name', 'text'),
    input('p_note', 'text', false, true),
  ],
  result: 'row:storage_locations',
  assistant: { tool: 'sheetbase.freezer.rename' },
  pipeline: {},
  events: [
    {
      name: 'freezer.renamed',
      family: 'storage',
      summary: 'A freezer was renamed.',
      producer: { entityType: 'storage_location', operation: 'update' },
    },
  ],
})

describe('operation declarations', () => {
  it('are all valid, with unique names and tools', () => {
    const errors = CORE_OPERATIONS.flatMap(validateOperation)
    expect(errors).toEqual([])
    const names = CORE_OPERATIONS.map((op) => op.name)
    expect(new Set(names).size).toBe(names.length)
    const tools = CORE_OPERATIONS.flatMap((op) =>
      op.assistant ? [op.assistant.tool] : [],
    )
    expect(new Set(tools).size).toBe(tools.length)
  })

  it('generate the pipeline action list the app uses', () => {
    expect(PIPELINE_ACTIONS).toEqual(pipelineActionsFrom(CORE_OPERATIONS))
    expect(PIPELINE_ACTIONS).toHaveLength(42)
    const next = PIPELINE_ACTIONS.find(
      (a) => a.operation === 'request_campaign_round',
    )
    expect(next?.arguments).toEqual([
      { name: 'p_record_id', type: 'uuid', required: true, nullable: false },
    ])
  })

  it('generate the agent vocabulary and the assistant card names', () => {
    expect([...AGENT_OPERATION_TOOL_NAMES]).toEqual(
      assistantToolsFrom(CORE_OPERATIONS, 'operation'),
    )
    for (const tool of assistantToolsFrom(CORE_OPERATIONS, 'propose'))
      expect(ASSISTANT_PROPOSE_TOOL_NAMES).toContain(tool)
  })

  it('put every declared event in the catalogue', () => {
    const names = new Set(EVENT_CATALOGUE.map((e) => e.name))
    for (const op of CORE_OPERATIONS)
      for (const event of op.events ?? [])
        expect(names.has(event.name), event.name).toBe(true)
  })

  it('put every operation with a summary on the API allowlist and docs', () => {
    const doc = readFileSync(join(process.cwd(), 'docs/api/lab-api.md'), 'utf8')
    for (const name of Object.keys(labRpcsFromOperations(CORE_OPERATIONS))) {
      expect(name in LAB_RPCS, name).toBe(true)
      expect(name in EXTERNAL_RPC_SCOPES, name).toBe(true)
      expect(doc, name).toContain(`\`${name}\``)
    }
  })
})

describe('adding one operation', () => {
  afterEach(() => unregisterOperations('sample', 'ws-1'))

  it('generates every surface from the one declaration', () => {
    expect(validateOperation(SAMPLE)).toEqual([])
    expect(labRpcsFromOperations([SAMPLE]).rename_freezer).toMatchObject({
      scope: 'lab:write',
      result: 'row:storage_locations',
      params: [
        ['p_freezer_id', 'uuid', 1],
        ['p_name', 'text', 1],
        ['p_note', 'text', 0],
      ],
    })
    expect(pipelineActionsFrom([SAMPLE])[0]).toMatchObject({
      operation: 'rename_freezer',
      rpc: 'rename_freezer',
      label: 'Rename a freezer',
    })
    expect(assistantToolsFrom([SAMPLE], 'propose')).toEqual([
      'sheetbase.freezer.rename',
    ])
    expect(
      eventEntriesFrom([SAMPLE], EVENT_CATALOGUE[0].consumers)[0],
    ).toMatchObject({ name: 'freezer.renamed', wireName: 'freezer.renamed' })
    expect(operationDocStub(SAMPLE)).toContain('| `p_name` | text | yes |')
  })

  it('is added for one workspace and removed again', () => {
    registerOperations('sample', [SAMPLE], 'ws-1')
    expect(pipelineActions('ws-1').map((a) => a.operation)).toContain(
      'rename_freezer',
    )
    expect(assistantProposeToolNames('ws-1')).toContain(
      'sheetbase.freezer.rename',
    )
    expect(findOperation('rename_freezer', 'ws-1')?.source).toBe('sample')
    expect(pipelineActions('ws-2').map((a) => a.operation)).not.toContain(
      'rename_freezer',
    )
    expect(
      validatePipelineActions(
        [{ name: 'r', operation: 'rename_freezer', arguments: {} }],
        'ws-1',
      ),
    ).not.toEqual(
      validatePipelineActions(
        [{ name: 'r', operation: 'rename_freezer', arguments: {} }],
        'ws-2',
      ),
    )
    unregisterOperations('sample', 'ws-1')
    expect(listOperations('ws-1')).toHaveLength(CORE_OPERATIONS.length)
    expect(agentOperationToolNames('ws-1')).toEqual([
      ...AGENT_OPERATION_TOOL_NAMES,
    ])
  })

  it('refuses a name or tool a built-in already uses', () => {
    expect(() =>
      registerOperations(
        'sample',
        [{ ...SAMPLE, name: 'start_campaign' }],
        'ws-1',
      ),
    ).toThrow(/already declared/)
    expect(() =>
      registerOperations(
        'sample',
        [{ ...SAMPLE, assistant: { tool: 'sheetbase.campaign.start' } }],
        'ws-1',
      ),
    ).toThrow(/already declared/)
    expect(listOperations('ws-1')).toHaveLength(CORE_OPERATIONS.length)
  })

  it('refuses a pipeline input type a pipeline cannot take', () => {
    expect(() =>
      pipelineActionsFrom([{ ...SAMPLE, inputs: [input('p_when', 'ts')] }]),
    ).toThrow(/cannot take ts/)
  })
})
