import { describe, expect, it, vi } from 'vitest'
import type { core } from 'zod'

import { ASSISTANT_PROPOSE_TOOL_NAMES } from '#/lib/agent-tool-catalogue'
import type { LabToolContext } from '#/lib/assistant-lab-tools.server'
import { createDataClient } from '#/lib/data-client'

import {
  MODELS_PROPOSE_TOOL_NAMES,
  MODEL_FIELD_ACTIVATE_TOOL,
  MODEL_FIELD_ADD_TOOL,
  MODEL_FIELD_EVOLVE_TOOL,
  MODEL_REGISTRY_CREATE_TOOL,
  MODEL_SUPPLIER_CREATE_TOOL,
  RECORD_SET_TYPE_TOOL,
  REGISTRY_REMOVE_PARENT_TOOL,
} from './cards'
import { runModelsAction } from './cards-run'
import { buildModelsProposal, modelsProposalDefs } from './cards.server'

const base = { title: 'T', summary: 'S' }

const urlOf = (input: Parameters<typeof fetch>[0]): URL =>
  input instanceof Request ? new URL(input.url) : new URL(input, 'http://x')

function context(
  tables: Record<string, core.util.JSONType[]>,
  rpcs: Record<string, core.util.JSONType> = {},
): LabToolContext {
  const fetchFixture: typeof fetch = async (input) => {
    const url = urlOf(input)
    const last = url.pathname.split('/').at(-1) ?? ''

    return Response.json(
      url.pathname.includes('/rpc/')
        ? (rpcs[last] ?? null)
        : (tables[last] ?? []),
    )
  }

  return {
    client: createDataClient(fetchFixture),
    workspaceId: 'ws',
    userId: 'me',
    timeZone: 'Europe/London',
  }
}

const cellLine = {
  id: 'm1',
  key: 'cell_line',
  name: 'Cell line',
  is_registry: true,
}

describe('the record type cards', () => {
  it('offers every tool, and every tool is on the gateway allowlist', () => {
    expect(
      modelsProposalDefs().map((def) => def.name.replaceAll('__', '.')),
    ).toEqual([...MODELS_PROPOSE_TOOL_NAMES])

    for (const name of MODELS_PROPOSE_TOOL_NAMES) {
      expect(ASSISTANT_PROPOSE_TOOL_NAMES, name).toContain(name)
    }
  })

  it('adds a registry with fields the database reads', async () => {
    const result = await buildModelsProposal(
      MODEL_REGISTRY_CREATE_TOOL,
      {
        ...base,
        name: 'Cell line',
        prefix: 'CL',
        fields: [
          { label: 'Species' },
          { label: 'Passage number', type: 'integer', showInList: true },
          { label: 'Status', choices: ['Frozen', 'In culture'] },
        ],
        keyFields: ['Species'],
        sequenceField: 'Passage number',
      },
      context({}),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.action).toEqual({
      kind: 'model.registry_create',
      key: 'cell_line',
      name: 'Cell line',
      prefix: 'CL',
      description: null,
      fields: [
        {
          field_name: 'species',
          label: 'Species',
          logical_type: 'text',
          show_in_list: false,
        },
        {
          field_name: 'passage_number',
          label: 'Passage number',
          logical_type: 'integer',
          show_in_list: true,
        },
        {
          field_name: 'status',
          label: 'Status',
          logical_type: 'category',
          show_in_list: false,
          options: [
            { key: 'frozen', label: 'Frozen' },
            { key: 'in_culture', label: 'In culture' },
          ],
        },
      ],
      keyFields: ['species'],
      sequenceField: 'passage_number',
    })
  })

  it('refuses a key that is taken', async () => {
    const result = await buildModelsProposal(
      MODEL_REGISTRY_CREATE_TOOL,
      {
        ...base,
        name: 'Cell line',
        prefix: 'CL',
        fields: [{ label: 'Species' }],
      },
      context({ record_models: [{ key: 'cell_line' }] }),
    )

    expect(result.ok).toBe(false)
  })

  it('adds the Supplier type only once', async () => {
    const first = await buildModelsProposal(
      MODEL_SUPPLIER_CREATE_TOOL,
      base,
      context({}),
    )

    const second = await buildModelsProposal(
      MODEL_SUPPLIER_CREATE_TOOL,
      base,
      context({ record_models: [{ key: 'supplier' }] }),
    )

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(false)
  })

  it('adds a field and switches it on', async () => {
    const result = await buildModelsProposal(
      MODEL_FIELD_ADD_TOOL,
      {
        ...base,
        model: 'cell_line',
        label: 'Mycoplasma status',
        type: 'category',
        choices: ['Clear', 'Positive'],
      },
      context({ record_models: [cellLine] }),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.action).toMatchObject({
      kind: 'model_field.add',
      modelKey: 'cell_line',
      fieldName: 'mycoplasma_status',
      logicalType: 'category',
      nullable: true,
      options: [
        { key: 'clear', label: 'Clear' },
        { key: 'positive', label: 'Positive' },
      ],
    })
  })

  it('only switches on a draft field', async () => {
    const result = await buildModelsProposal(
      MODEL_FIELD_ACTIVATE_TOOL,
      { ...base, model: 'Cell line', field: 'Species' },
      context({ record_models: [cellLine], record_field_definitions: [] }),
    )

    expect(result.ok).toBe(false)
  })

  it('refuses a change that would break data and confirms one that needs it', async () => {
    const tables = {
      record_models: [cellLine],
      record_field_definitions: [
        {
          id: 'f1',
          field_name: 'species',
          label: 'Species',
          logical_type: 'text',
          lifecycle: 'active',
        },
      ],
    }

    const blocked = await buildModelsProposal(
      MODEL_FIELD_EVOLVE_TOOL,
      { ...base, model: 'cell_line', field: 'Species', action: 'retire' },
      context(tables, {
        preview_model_field_evolution: {
          classification: 'breaking',
          reason: 'In use',
          blocked: true,
        },
      }),
    )

    expect(blocked.ok).toBe(false)

    const confirmed = await buildModelsProposal(
      MODEL_FIELD_EVOLVE_TOOL,
      {
        ...base,
        model: 'cell_line',
        field: 'Species',
        action: 'update',
        label: 'Organism',
      },
      context(tables, {
        preview_model_field_evolution: {
          classification: 'confirm',
          reason: '12 records',
          blocked: false,
        },
      }),
    )

    if (!confirmed.ok) throw new Error(confirmed.message)
    expect(confirmed.proposal.action).toMatchObject({
      kind: 'model_field.evolve',
      action: 'update',
      patch: { label: 'Organism' },
      confirm: true,
    })
  })

  it('changes the type of a record, finding it by ID', async () => {
    const result = await buildModelsProposal(
      RECORD_SET_TYPE_TOOL,
      { ...base, item: 'MAT-0012', type: 'cell_line' },
      context({
        records: [
          {
            id: 'rec1',
            identifier: 'MAT-0012',
            title: 'Reagent',
            kind: 'material',
            metadata_version: 1,
          },
        ],
        record_models: [cellLine],
      }),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.action).toEqual({
      kind: 'record.set_type',
      host: 'records',
      id: 'rec1',
      modelKey: 'cell_line',
      customFields: {},
    })
  })

  it('removes a parent from a registry entry', async () => {
    const result = await buildModelsProposal(
      REGISTRY_REMOVE_PARENT_TOOL,
      { ...base, entry: 'CL-0002', parent: 'CL-0001' },
      context({
        record_models: [{ key: 'cell_line' }],
        records: [
          {
            id: 'a',
            identifier: 'CL-0002',
            title: 'Child',
            kind: 'cell_line',
            metadata_version: 1,
          },
          {
            id: 'b',
            identifier: 'CL-0001',
            title: 'Parent',
            kind: 'cell_line',
            metadata_version: 1,
          },
        ],
      }),
    )

    if (!result.ok) throw new Error(result.message)
    expect(result.proposal.action).toEqual({
      kind: 'registry.remove_parent',
      entryId: 'a',
      parentId: 'b',
    })
  })
})

describe('pressing a record type card', () => {
  it('sends the fields as the database reads them', async () => {
    const rpc = vi.fn(async () => ({}))

    await runModelsAction(
      { rpc },
      {
        kind: 'model_field.plugin_type',
        modelKey: 'compound',
        fieldName: 'structure',
        pluginKey: null,
        typeId: null,
      },
    )

    expect(rpc).toHaveBeenCalledWith('set_field_plugin_type', {
      p_kind: 'compound',
      p_field_name: 'structure',
    })
  })
})
