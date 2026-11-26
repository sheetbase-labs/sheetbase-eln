import { isRpcActionOf } from '#/lib/assistant-rpc-cards'
import type { RpcAction, RpcCardInfo } from '#/lib/assistant-rpc-cards'

/** Data contract and lineage cards (see `#/lib/assistant-rpc-cards`). */
export const CONTRACT_CARDS = [
  {
    tool: 'sheetbase.contract.save',
    covers: ['save_data_contract'],
    words: ['Save contract', 'Saving…', 'Contract saved'],
    does: 'save a data contract',
  },
  {
    tool: 'sheetbase.contract.delete',
    covers: ['delete_data_contract'],
    words: ['Delete contract', 'Deleting…', 'Contract deleted'],
    does: 'delete a data contract',
  },
  {
    tool: 'sheetbase.contract.import_odcs',
    covers: ['import_data_contract_odcs'],
    words: ['Import contract', 'Importing…', 'Contract imported'],
    does: 'import a data contract',
  },
  {
    tool: 'sheetbase.contract.remove_rule',
    covers: ['remove_contract_rule'],
    words: ['Remove rule', 'Removing…', 'Rule removed'],
    does: 'remove a contract rule',
  },
  {
    tool: 'sheetbase.lineage.save_target',
    covers: ['save_lineage_target'],
    words: ['Save target', 'Saving…', 'Target saved'],
    does: 'save a lineage target',
  },
  {
    tool: 'sheetbase.lineage.delete_target',
    covers: ['delete_lineage_target'],
    words: ['Delete target', 'Deleting…', 'Target deleted'],
    does: 'delete a lineage target',
  },
  {
    tool: 'sheetbase.lineage.retry',
    covers: ['retry_lineage_deliveries'],
    words: ['Try again', 'Trying…', 'Sent again'],
    does: 'send a lineage target’s failed deliveries again',
  },
] as const satisfies readonly RpcCardInfo[]

export type ContractCardsProposeToolName =
  (typeof CONTRACT_CARDS)[number]['tool']

export type ContractCardsAction = RpcAction<ContractCardsProposeToolName>

export const isContractCardsAction =
  isRpcActionOf<ContractCardsProposeToolName>(CONTRACT_CARDS)
