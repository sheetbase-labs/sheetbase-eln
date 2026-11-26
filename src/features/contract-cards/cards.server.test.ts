import { describe, expect, it } from 'vitest'

import { ASSISTANT_PROPOSE_TOOL_NAMES } from '#/lib/agent-tool-catalogue'
import { ask } from '#/lib/assistant-rpc-cards.fixture'

import { CONTRACT_CARDS } from './cards'
import { CONTRACT_CARD_SPECS } from './cards.server'

const table = {
  id: 't1',
  key: 'plate_reads',
  name: 'Plate reads',
  display_id: null,
  lifecycle: 'active',
}

const contract = {
  id: 'c1',
  name: 'Plate reads contract',
  lifecycle: 'active',
  dataset_schema_id: 't1',
  record_model_key: null,
  rules: [
    { id: 'r-od', kind: 'range', field: 'od600', mode: 'block' },
    { id: 'r-fresh', kind: 'freshness', field: null, mode: 'warn' },
  ],
}

const target = {
  id: 'lt1',
  name: 'Marquez',
  endpoint_url: 'https://lineage.example.com/api',
  namespace: 'sheetbase',
  auth_header_name: 'Authorization',
  enabled: false,
}

const ask1 = (
  tool: string,
  input: Parameters<typeof ask>[2],
  tables: Parameters<typeof ask>[3],
) => ask(CONTRACT_CARD_SPECS, tool, input, tables)

describe('the contract cards', () => {
  it('offers every tool, and every tool is on the gateway allowlist', () => {
    expect(CONTRACT_CARD_SPECS.map((card) => card.tool)).toEqual(
      CONTRACT_CARDS.map((card) => card.tool),
    )

    for (const card of CONTRACT_CARD_SPECS) {
      expect(ASSISTANT_PROPOSE_TOOL_NAMES, card.tool).toContain(card.tool)
    }
  })

  it('saves the contract on a measurement table with its rules and schedule', async () => {
    const result = await ask1(
      'sheetbase.contract.save',
      {
        table: 'plate_reads',
        rules: [
          { kind: 'range', field: 'od600', min: 0, max: 4, mode: 'block' },
        ],
        scheduleMinutes: 60,
      },
      { dataset_schema_definitions: [table] },
    )

    expect(result.action?.rpc).toBe('save_data_contract')
    expect(result.action?.args).toMatchObject({
      p_dataset_schema_id: 't1',
      p_record_model_key: null,
      p_rules: [
        { kind: 'range', field: 'od600', min: 0, max: 4, mode: 'block' },
      ],
      p_schedule_minutes: 60,
      p_name: null,
    })
  })

  it('needs exactly one home and something to save', async () => {
    const both = await ask1(
      'sheetbase.contract.save',
      { table: 'a', recordType: 'b', scheduleMinutes: 5 },
      {},
    )

    expect(both.ok).toBe(false)

    const nothing = await ask1(
      'sheetbase.contract.save',
      { table: 'plate_reads' },
      { dataset_schema_definitions: [table] },
    )

    expect(nothing.ok).toBe(false)
    expect(nothing.message).toContain('Nothing to save')
  })

  it('deletes a contract found by name', async () => {
    const result = await ask1(
      'sheetbase.contract.delete',
      { contract: 'Plate reads contract' },
      { data_contracts: [contract] },
    )

    expect(result.action?.rpc).toBe('delete_data_contract')
    expect(result.action?.args).toEqual({ p_contract_id: 'c1' })
  })

  it('imports an ODCS document onto a record type', async () => {
    const result = await ask1(
      'sheetbase.contract.import_odcs',
      { recordType: 'cell_bank', odcs: { apiVersion: 'v3.1.0' } },
      { record_models: [{ key: 'cell_bank', name: 'Cell bank' }] },
    )

    expect(result.action?.rpc).toBe('import_data_contract_odcs')
    expect(result.action?.args).toEqual({
      p_odcs: { apiVersion: 'v3.1.0' },
      p_dataset_schema_id: null,
      p_record_model_key: 'cell_bank',
    })
  })

  it('removes a rule by its ID, its field or its kind', async () => {
    const byField = await ask1(
      'sheetbase.contract.remove_rule',
      { contract: 'Plate reads contract', rule: 'od600' },
      { data_contracts: [contract] },
    )

    expect(byField.action?.rpc).toBe('remove_contract_rule')
    expect(byField.action?.args).toEqual({
      p_contract_id: 'c1',
      p_rule_id: 'r-od',
    })

    const missing = await ask1(
      'sheetbase.contract.remove_rule',
      { contract: 'Plate reads contract', rule: 'unique' },
      { data_contracts: [contract] },
    )

    expect(missing.ok).toBe(false)
  })

  it('sets up a lineage target, keeping what an existing one already has', async () => {
    const created = await ask1(
      'sheetbase.lineage.save_target',
      {
        name: 'Marquez',
        endpointUrl: 'https://lineage.example.com/api',
        enabled: true,
      },
      {},
    )

    expect(created.action?.rpc).toBe('save_lineage_target')
    expect(created.action?.args).toMatchObject({
      p_workspace_id: 'ws',
      p_id: null,
      p_namespace: 'sheetbase',
      p_enabled: true,
    })

    const changed = await ask1(
      'sheetbase.lineage.save_target',
      { name: 'Marquez', enabled: true },
      { lineage_targets: [target] },
    )

    expect(changed.action?.args).toMatchObject({
      p_id: 'lt1',
      p_endpoint_url: 'https://lineage.example.com/api',
      p_enabled: true,
    })

    const noUrl = await ask1(
      'sheetbase.lineage.save_target',
      { name: 'New one' },
      {},
    )

    expect(noUrl.ok).toBe(false)
  })

  it('deletes a target and retries its deliveries', async () => {
    const deleted = await ask1(
      'sheetbase.lineage.delete_target',
      { target: 'Marquez' },
      { lineage_targets: [target] },
    )

    expect(deleted.action?.rpc).toBe('delete_lineage_target')
    expect(deleted.action?.args).toEqual({ p_id: 'lt1' })

    const retried = await ask1(
      'sheetbase.lineage.retry',
      { target: 'Marquez' },
      { lineage_targets: [target] },
    )

    expect(retried.action?.rpc).toBe('retry_lineage_deliveries')
    expect(retried.action?.args).toEqual({ p_target_id: 'lt1' })
  })
})
