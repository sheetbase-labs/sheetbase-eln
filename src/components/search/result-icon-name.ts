import type { IconName } from '#/components/icons'
import type { SearchResult } from '#/lib/search'

const BY_TYPE = new Map<string, IconName>([
  ['file', 'download'],
  ['dataset', 'table'],
  ['dataset_row', 'table'],
  ['sheet', 'table'],
  ['sheet_row', 'table'],
  ['template', 'template'],
  ['comment', 'comment'],
  ['project', 'folder'],
  ['pipeline', 'pipeline'],
  ['analysis', 'chart'],
  ['instrument', 'scan'],
  ['instrument_run', 'play'],
  ['booking', 'calendar'],
  ['storage_location', 'archive'],
  ['client', 'user'],
  ['deviation', 'warn'],
  ['plate_design', 'schema'],
  ['parser', 'code'],
  ['person', 'user'],
])

const BY_KIND = new Map<string, IconName>([
  ['experiment', 'flask'],
  ['sample', 'tube'],
  ['material', 'box'],
  ['protocol_template', 'protocol'],
  ['report', 'report'],
])

/** Plugin types may be arbitrary strings; unrecognised types keep the box fallback. */
export type IconResult = Pick<SearchResult, 'kind' | 'matchedField'> & {
  resultType: string
}

/** The icon a result row leads with, from its type and, for records, its kind. */
export function searchResultIconName(result: IconResult): IconName {
  if (result.resultType === 'record') return BY_KIND.get(result.kind) ?? 'box'

  return BY_TYPE.get(result.resultType) ?? 'box'
}
