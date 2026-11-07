/**
 * Data contracts as the app reads and changes them, through the same database
 * functions the API, the assistant and pipelines call.
 */
import type { DataClient } from '#/lib/data-client'
import type {
  ContractDatasetStatus,
  ContractGateReport,
  ContractLifecycle,
  ContractPreviewEntry,
  ContractRule,
  ContractRun,
  ContractStatus,
  ContractTarget,
  DataContract,
} from './types'

export const contractKeys = {
  all: ['data-contracts'] as const,
  list: ['data-contracts', 'list'] as const,
  target: (target: ContractTarget) =>
    [
      'data-contracts',
      'target',
      target.kind === 'dataset_schema' ? target.id : target.key,
    ] as const,
  runs: (contractId: string) =>
    ['data-contracts', 'runs', contractId] as const,
  datasetStatus: (datasetId: string) =>
    ['data-contracts', 'dataset', datasetId] as const,
  record: (recordId: string, version: number | string) =>
    ['data-contracts', 'record', recordId, version] as const,
}

interface ContractWire {
  id: string
  workspace_id: string
  dataset_schema_id: string | null
  record_model_key: string | null
  name: string
  description: string | null
  owner_user_id: string | null
  version: number
  lifecycle: ContractLifecycle
  rules: ContractRule[]
  schedule_minutes: number | null
  next_check_at: string | null
  last_status: ContractStatus | null
  last_checked_at: string | null
  updated_at: string
}

export function toContract(row: ContractWire): DataContract {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    datasetSchemaId: row.dataset_schema_id,
    recordModelKey: row.record_model_key,
    name: row.name,
    description: row.description,
    ownerUserId: row.owner_user_id,
    version: row.version,
    lifecycle: row.lifecycle,
    rules: row.rules ?? [],
    scheduleMinutes: row.schedule_minutes,
    nextCheckAt: row.next_check_at,
    lastStatus: row.last_status,
    lastCheckedAt: row.last_checked_at,
    updatedAt: row.updated_at,
  }
}

interface RunWire {
  id: string
  contract_id: string
  contract_version: number
  dataset_id: string | null
  trigger: ContractRun['trigger']
  scope: ContractRun['scope']
  status: ContractStatus
  rows_checked: number | string
  failed_rules: number
  blocked: boolean
  results: ContractRun['results']
  created_at: string
}

export function toRun(row: RunWire): ContractRun {
  return {
    id: row.id,
    contractId: row.contract_id,
    contractVersion: row.contract_version,
    datasetId: row.dataset_id,
    trigger: row.trigger,
    scope: row.scope,
    status: row.status,
    rowsChecked: Number(row.rows_checked),
    failedRules: row.failed_rules,
    blocked: row.blocked,
    results: row.results ?? [],
    createdAt: row.created_at,
  }
}

const CONTRACT_COLUMNS =
  'id,workspace_id,dataset_schema_id,record_model_key,name,description,owner_user_id,version,lifecycle,rules,schedule_minutes,next_check_at,last_status,last_checked_at,updated_at'

/** Every contract, for badges beside lists of models. */
export async function fetchContracts(
  client: Pick<DataClient, 'list'>,
): Promise<DataContract[]> {
  const rows = await client.list<ContractWire>(
    'data_contracts',
    `?select=${CONTRACT_COLUMNS}&lifecycle=neq.retired&limit=500`,
  )
  return rows.map(toContract)
}

export async function fetchContractForTarget(
  client: Pick<DataClient, 'list'>,
  target: ContractTarget,
): Promise<DataContract | null> {
  const filter =
    target.kind === 'dataset_schema'
      ? `dataset_schema_id=eq.${encodeURIComponent(target.id)}`
      : `record_model_key=eq.${encodeURIComponent(target.key)}`
  const rows = await client.list<ContractWire>(
    'data_contracts',
    `?${filter}&select=${CONTRACT_COLUMNS}&limit=1`,
  )
  return rows[0] ? toContract(rows[0]) : null
}

export interface SaveContractInput {
  target: ContractTarget
  rules?: ContractRule[]
  name?: string
  description?: string
  ownerUserId?: string
  lifecycle?: ContractLifecycle
  /** 0 turns scheduled checks off. */
  scheduleMinutes?: number
}

export async function saveContract(
  client: Pick<DataClient, 'rpc'>,
  input: SaveContractInput,
): Promise<DataContract> {
  const row = await client.rpc<ContractWire>('save_data_contract', {
    p_dataset_schema_id:
      input.target.kind === 'dataset_schema' ? input.target.id : null,
    p_record_model_key:
      input.target.kind === 'record_model' ? input.target.key : null,
    p_rules: input.rules ?? null,
    p_name: input.name ?? null,
    p_description: input.description ?? null,
    p_owner_user_id: input.ownerUserId ?? null,
    p_lifecycle: input.lifecycle ?? null,
    p_schedule_minutes: input.scheduleMinutes ?? null,
  })
  return toContract(row)
}

export async function addRule(
  client: Pick<DataClient, 'rpc'>,
  contractId: string,
  rule: Omit<ContractRule, 'id'> & { id?: string },
): Promise<DataContract> {
  const body = { ...rule }
  if (!body.id) delete body.id
  return toContract(
    await client.rpc<ContractWire>('add_contract_rule', {
      p_contract_id: contractId,
      p_rule: body,
    }),
  )
}

export async function removeRule(
  client: Pick<DataClient, 'rpc'>,
  contractId: string,
  ruleId: string,
): Promise<DataContract> {
  return toContract(
    await client.rpc<ContractWire>('remove_contract_rule', {
      p_contract_id: contractId,
      p_rule_id: ruleId,
    }),
  )
}

export async function deleteContract(
  client: Pick<DataClient, 'rpc'>,
  contractId: string,
): Promise<void> {
  await client.rpc('delete_data_contract', { p_contract_id: contractId })
}

export interface CheckOutcome {
  contractId: string
  status: ContractStatus | null
  runs: ContractRun[]
}

export async function runCheck(
  client: Pick<DataClient, 'rpc'>,
  contractId: string,
  datasetId?: string,
): Promise<CheckOutcome> {
  const result = await client.rpc<{
    contractId: string
    status: ContractStatus | null
    runs: RunWire[]
  }>('run_contract_check', {
    p_contract_id: contractId,
    p_dataset_id: datasetId ?? null,
  })
  return {
    contractId: result.contractId,
    status: result.status,
    runs: result.runs.map(toRun),
  }
}

export async function previewRules(
  client: Pick<DataClient, 'rpc'>,
  contractId: string,
  rules: ContractRule[],
  datasetId?: string,
): Promise<ContractPreviewEntry[]> {
  return client.rpc<ContractPreviewEntry[]>('preview_contract_rules', {
    p_contract_id: contractId,
    p_rules: rules,
    p_dataset_id: datasetId ?? null,
  })
}

export async function fetchRuns(
  client: Pick<DataClient, 'list'>,
  contractId: string,
  limit = 25,
): Promise<ContractRun[]> {
  const rows = await client.list<RunWire>(
    'data_contract_runs',
    `?contract_id=eq.${encodeURIComponent(contractId)}&select=*&order=created_at.desc&limit=${limit}`,
  )
  return rows.map(toRun)
}

interface DatasetStatusWire {
  contract_id: string
  dataset_id: string
  status: ContractStatus
  failed_rules: number
  run_id: string
  checked_at: string
}

export async function fetchDatasetStatus(
  client: Pick<DataClient, 'list'>,
  datasetId: string,
): Promise<ContractDatasetStatus | null> {
  const rows = await client.list<DatasetStatusWire>(
    'data_contract_dataset_status',
    `?dataset_id=eq.${encodeURIComponent(datasetId)}&select=*&limit=1`,
  )
  const row = rows[0]
  return row
    ? {
        contractId: row.contract_id,
        datasetId: row.dataset_id,
        status: row.status,
        failedRules: row.failed_rules,
        runId: row.run_id,
        checkedAt: row.checked_at,
      }
    : null
}

/** Advisory check of one record against its model's contract. */
export async function checkRecord(
  client: Pick<DataClient, 'rpc'>,
  recordId: string,
): Promise<ContractGateReport & { contractName?: string }> {
  const result = await client.rpc<
    ContractGateReport & { checked: boolean; status?: ContractStatus }
  >('check_record_contract', { p_record_id: recordId })
  return result
}

/** Advisory check of records about to be created. */
export async function checkRecordBatch(
  client: Pick<DataClient, 'rpc'>,
  modelKey: string,
  rows: Array<{ values: Record<string, unknown> }>,
): Promise<ContractGateReport> {
  return client.rpc<ContractGateReport>('check_record_batch_contract', {
    p_record_model_key: modelKey,
    p_rows: rows,
  })
}

export async function exportOdcs(
  client: Pick<DataClient, 'rpc'>,
  contractId: string,
): Promise<Record<string, unknown>> {
  return client.rpc<Record<string, unknown>>('export_data_contract_odcs', {
    p_contract_id: contractId,
  })
}

export interface OdcsImportResult {
  contract: DataContract
  rulesImported: number
  ignored: string[]
}

export async function importOdcs(
  client: Pick<DataClient, 'rpc'>,
  document: Record<string, unknown>,
  target?: ContractTarget,
): Promise<OdcsImportResult> {
  const result = await client.rpc<{
    contract: ContractWire
    rulesImported: number
    ignored: string[]
  }>('import_data_contract_odcs', {
    p_odcs: document,
    p_dataset_schema_id: target?.kind === 'dataset_schema' ? target.id : null,
    p_record_model_key: target?.kind === 'record_model' ? target.key : null,
  })
  return {
    contract: toContract(result.contract),
    rulesImported: result.rulesImported,
    ignored: result.ignored,
  }
}
