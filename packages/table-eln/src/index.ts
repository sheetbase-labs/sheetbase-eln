/**
 * @sheetbase/table-eln — ELN semantics over the sheetbase-table engine seams.
 *
 * Phase 1 extension layer: status chips, units, record-reference labels and
 * pickers, "Open record" navigation and locked-sheet affordances, all built
 * strictly on the engine's public extension points (renderCell,
 * customEditors, contextMenuActions, datasetHeader fields, readOnlyRows).
 */
export {
  createElnCellRenderer,
  type ElnCellRendererConfig,
  type ElnColumnConfig,
  type ElnStatusStyle,
} from './cells'
export {
  createRecordMenuActions,
  type RecordMenuActionOptions,
} from './menu'
export {
  createRecordPickerEditor,
  type RecordPickerEditorOptions,
  type RecordPickerHit,
} from './picker'
export { LockedSheetBadge, readOnlyRowSet } from './locked'
