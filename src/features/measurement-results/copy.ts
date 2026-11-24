/** Words for the Results tab of a measurement table, read as `t('features.measurementResults.…')`. */
export const copy = {
  tab: 'Results',
  datasetColumn: 'Dataset',
  snapshotColumn: 'Snapshot',
  live: 'Live',
  mode: 'Read',
  modeLive: 'Datasets as they are now',
  modeSnapshot: 'Newest snapshot of each dataset',
  datasets: 'Datasets',
  allDatasets: 'All datasets',
  oneDataset: '{count} dataset',
  someDatasets: '{count} datasets',
  empty: 'No results yet',
  emptyHint:
    'Results appear here when a dataset built on this table has rows you can open.',
  summary: '{rows} rows from {datasets} read',
  leftOut: '{names} left out: no snapshot yet.',
  more: 'Showing the first {shown} of {total} rows.',
  loadError: 'Could not read the results.',
} as const
