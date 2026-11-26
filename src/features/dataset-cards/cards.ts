import { isRpcActionOf } from '#/lib/assistant-rpc-cards'
import type { RpcAction, RpcCardInfo } from '#/lib/assistant-rpc-cards'

/** Dataset and column promotion cards (see `#/lib/assistant-rpc-cards`). */
export const DATASET_CARDS = [
  {
    tool: 'sheetbase.dataset.add_rows',
    covers: ['commit_dataset_row_batch', 'commit_dataset_row_batch_atomic'],
    words: ['Add rows', 'Adding…', 'Rows added'],
    does: 'add rows to a dataset',
  },
  {
    tool: 'sheetbase.dataset.create_from_columns',
    covers: ['create_dataset_structure_from_file'],
    words: ['Create dataset structure', 'Creating…', 'Structure created'],
    does: 'create a dataset structure',
  },
  {
    tool: 'sheetbase.dataset.add_columns',
    covers: ['apply_dataset_schema_evolution'],
    words: ['Add columns', 'Adding…', 'Columns added'],
    does: 'add columns to a dataset',
  },
  {
    tool: 'sheetbase.measurement_table.move_under',
    covers: ['reparent_dataset_schema'],
    words: ['Move table', 'Moving…', 'Table moved'],
    does: 'move a measurement table',
  },
  {
    tool: 'sheetbase.dataset.promote_column',
    covers: ['request_column_promotion'],
    words: ['Request promotion', 'Requesting…', 'Promotion requested'],
    does: 'promote a sheet column',
  },
  {
    tool: 'sheetbase.dataset.apply_promotion',
    covers: ['apply_column_promotion'],
    words: ['Apply promotion', 'Applying…', 'Promotion applied'],
    does: 'apply a column promotion',
  },
  {
    tool: 'sheetbase.dataset.promote_calculation',
    covers: ['promote_calculation'],
    words: ['Promote calculation', 'Promoting…', 'Calculation promoted'],
    does: 'promote a sheet calculation',
  },
] as const satisfies readonly RpcCardInfo[]

export type DatasetCardsProposeToolName = (typeof DATASET_CARDS)[number]['tool']

export type DatasetCardsAction = RpcAction<DatasetCardsProposeToolName>

export const isDatasetCardsAction =
  isRpcActionOf<DatasetCardsProposeToolName>(DATASET_CARDS)
