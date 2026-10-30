import { Icon } from '#/components/v3/icons'
import type { IconName } from '#/components/v3/icons'
import type { SearchResult } from '#/lib/search'

const BY_TYPE: Partial<Record<SearchResult['resultType'], IconName>> = {
  file: 'download',
  dataset: 'table',
  dataset_row: 'table',
  sheet: 'table',
  sheet_row: 'table',
  template: 'template',
  comment: 'comment',
  project: 'folder',
  pipeline: 'pipeline',
  analysis: 'chart',
  instrument: 'scan',
  instrument_run: 'play',
  booking: 'calendar',
  storage_location: 'archive',
  client: 'user',
  deviation: 'warn',
  plate_design: 'schema',
  parser: 'code',
  person: 'user',
}

const BY_KIND: Record<string, IconName> = {
  experiment: 'flask',
  sample: 'tube',
  material: 'box',
  protocol_template: 'protocol',
  report: 'report',
}

/** The icon a result row leads with, from its type and, for records, its kind. */
export function searchResultIconName(
  result: Pick<SearchResult, 'resultType' | 'kind' | 'matchedField'>,
): IconName {
  if (result.resultType === 'record') return BY_KIND[result.kind] ?? 'box'
  return BY_TYPE[result.resultType] ?? 'box'
}

export function SearchResultIcon({
  result,
}: {
  result: Pick<SearchResult, 'resultType' | 'kind' | 'matchedField'>
}) {
  return (
    <Icon
      name={searchResultIconName(result)}
      size={14}
      className="text-fg-muted"
      aria-hidden
    />
  )
}
