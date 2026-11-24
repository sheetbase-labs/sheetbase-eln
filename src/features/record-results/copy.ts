/** The Results tab on a record, read as `t('features.recordResults.…')`. */
export const copy = {
  title: 'Results',
  tableLabel: '{table} results',
  rows: { one: '{count} result', other: '{count} results' },
  snapshots: 'Include snapshots',
  snapshotsHint: 'Also show rows kept in dataset snapshots.',
  intro:
    'Every dataset row that links to this record, grouped by measurement table. Open a row to see it in its dataset.',
  dataset: 'Dataset',
  source: 'Source',
  recorded: 'Recorded',
  live: 'Live',
  snapshot: 'Snapshot {label}',
  planned: 'Planned',
  yes: 'Yes',
  no: 'No',
  empty: 'No results yet',
  emptyHint:
    'Rows in a dataset show here when one of its link columns points at this record.',
  loading: 'Loading results…',
  error: 'Results could not be loaded.',
  retry: 'Try again',
  more: 'Showing the first {shown} of {total} results.',
  tab: 'Results',
} as const
