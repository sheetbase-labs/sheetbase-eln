import { isRpcActionOf } from '#/lib/assistant-rpc-cards'
import type { RpcAction, RpcCardInfo } from '#/lib/assistant-rpc-cards'

/**
 * Sheet and sheet layout cards. Each is a confirm card: the model names the
 * sheet, the server finds it by name or ID (SHT-0012), and the button runs
 * the ordinary call as the person (see `#/lib/assistant-rpc-cards`).
 */
export const SHEET_CARDS = [
  {
    tool: 'sheetbase.sheet.create',
    covers: ['create_sheet_instance', 'create_sheet_instance_from_definition'],
    words: ['Create sheet', 'Creating…', 'Sheet created'],
    does: 'create a sheet',
  },
  {
    tool: 'sheetbase.sheet.edit_data',
    covers: ['mutate_sheet_instance_local_state'],
    words: ['Save changes', 'Saving…', 'Saved'],
    does: 'change a sheet’s columns and rows',
  },
  {
    tool: 'sheetbase.sheet.calculate',
    covers: ['mutate_sheet_instance_calculations'],
    words: ['Save calculation', 'Saving…', 'Calculation saved'],
    does: 'add or remove a sheet calculation',
  },
  {
    tool: 'sheetbase.sheet.comment',
    covers: ['create_sheet_comment'],
    words: ['Add comment', 'Adding…', 'Comment added'],
    does: 'comment on a sheet',
  },
  {
    tool: 'sheetbase.sheet.upgrade_layout',
    covers: ['apply_sheet_instance_definition_upgrade'],
    words: ['Upgrade sheet', 'Upgrading…', 'Sheet upgraded'],
    does: 'upgrade a sheet to its newest layout',
  },
  {
    tool: 'sheetbase.sheet.add_to_notebook',
    covers: ['insert_sheet_instance_block'],
    words: ['Add to notebook', 'Adding…', 'Added to notebook'],
    does: 'add a sheet to a notebook',
  },
  {
    tool: 'sheetbase.sheet.duplicate_in_notebook',
    covers: ['duplicate_sheet_instance_block'],
    words: ['Make a copy', 'Copying…', 'Copied'],
    does: 'copy a sheet in a notebook',
  },
  {
    tool: 'sheetbase.sheet.save_as_layout',
    covers: ['extract_sheet_definition_draft'],
    words: ['Make layout', 'Making…', 'Layout made'],
    does: 'save a sheet as a layout',
  },
  {
    tool: 'sheetbase.sheet_layout.create',
    covers: ['create_sheet_definition'],
    words: ['Create layout', 'Creating…', 'Layout created'],
    does: 'create a sheet layout',
  },
  {
    tool: 'sheetbase.sheet_layout.rename',
    covers: ['update_sheet_definition'],
    words: ['Save changes', 'Saving…', 'Saved'],
    does: 'change a sheet layout',
  },
  {
    tool: 'sheetbase.sheet_layout.add_version',
    covers: ['create_sheet_definition_version'],
    words: ['Start version', 'Starting…', 'Version started'],
    does: 'start a new sheet layout version',
  },
  {
    tool: 'sheetbase.sheet_layout.edit_draft',
    covers: ['update_sheet_definition_draft'],
    words: ['Save draft', 'Saving…', 'Draft saved'],
    does: 'change a sheet layout draft',
  },
  {
    tool: 'sheetbase.sheet_layout.retire_version',
    covers: ['retire_sheet_definition_version'],
    words: ['Retire version', 'Retiring…', 'Version retired'],
    does: 'retire a sheet layout version',
  },
] as const satisfies readonly RpcCardInfo[]

export type SheetCardsProposeToolName = (typeof SHEET_CARDS)[number]['tool']

export type SheetCardsAction = RpcAction<SheetCardsProposeToolName>

export const isSheetCardsAction =
  isRpcActionOf<SheetCardsProposeToolName>(SHEET_CARDS)
