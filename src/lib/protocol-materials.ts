import type { DataClient } from '#/lib/data-client'
import type {
  BlockWire,
  NotebookBlock,
  NotebookRecord,
  RecordWire,
} from '#/lib/notebook-data'
import { toBlock, toRecord } from '#/lib/notebook-data'

export interface MaterialUnit {
  code: string
  symbol: string
  quantityKind?: string
}

export interface MaterialItem {
  id: string
  materialRecordId: string
  kind: 'sample' | 'material'
  identifier: string
  title: string
  quantity: number
  unit: MaterialUnit
  note?: string
  observedAt: string
}

export interface ProtocolReferencePayload {
  protocolRecordId: string
  protocolIdentifier: string
  protocolTitle: string
  protocolRevisionId: string
  version: string
  approvalStatus: string
  pinnedAt: string
  pinnedByUserId: string
}

export interface ProcedureExecutionPayload {
  text: string
  stepNumber: number
  sourceProtocolRevisionId: string
  sourceStepBlockId: string
  completed: boolean
  note: string
  completedAt: string | null
  completedByUserId: string | null
}

export interface MaterialAlert {
  kind: 'unavailable' | 'archived' | 'expired' | 'low_stock'
  label: string
}

export function materialAlerts(
  record: NotebookRecord | null,
  today = new Date(),
): MaterialAlert[] {
  if (!record || record.deletedAt) {
    return [{ kind: 'unavailable', label: 'Unavailable' }]
  }
  const alerts: MaterialAlert[] = []
  if (record.archivedAt) alerts.push({ kind: 'archived', label: 'Archived' })
  const expiry = record.properties.expiry
  const expiredByDate =
    typeof expiry === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(expiry)
      ? expiry < today.toISOString().slice(0, 10)
      : false
  if (record.status === 'expired' || expiredByDate) {
    alerts.push({ kind: 'expired', label: 'Expired' })
  }
  const quantity = record.properties.quantity
  const threshold = record.properties.low_stock_threshold
  if (
    record.status === 'low_stock' ||
    (typeof quantity === 'number' &&
      typeof threshold === 'number' &&
      quantity <= threshold)
  ) {
    alerts.push({ kind: 'low_stock', label: 'Low stock' })
  }
  if (['consumed', 'quarantined'].includes(record.status)) {
    alerts.push({ kind: 'unavailable', label: 'Unavailable' })
  }
  return alerts
}

export async function fetchMaterialRecords(
  client: DataClient,
  ids: string[],
): Promise<Map<string, NotebookRecord>> {
  if (ids.length === 0) return new Map()
  const rows = await client.list<RecordWire>(
    'records',
    `?id=in.(${ids.join(',')})`,
  )
  return new Map(rows.map((row) => [row.id, toRecord(row)]))
}

export async function pinProtocolReference(
  client: DataClient,
  args: {
    blockId: string
    protocolRecordId: string
    expectedBlockVersion: number
    expectedStructureVersion: number
  },
): Promise<{
  block: NotebookBlock
  copiedSteps: NotebookBlock[]
  structureVersion: number
  revisionId: string
}> {
  const result = await client.rpc<{
    block: BlockWire
    revision: { id: string }
    copied_steps: BlockWire[]
    structure_version: number
  }>('pin_protocol_reference', {
    p_block_id: args.blockId,
    p_protocol_record_id: args.protocolRecordId,
    p_expected_block_version: args.expectedBlockVersion,
    p_expected_structure_version: args.expectedStructureVersion,
  })
  return {
    block: toBlock(result.block),
    copiedSteps: result.copied_steps.map(toBlock),
    structureVersion: result.structure_version,
    revisionId: result.revision.id,
  }
}
