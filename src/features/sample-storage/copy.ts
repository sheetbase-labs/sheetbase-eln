/** Words on the sample and storage cards, read as `t('features.sampleStorage.…')`. */
export const copy = {
  cards: {
    withdraw: { apply: 'Take it', applying: 'Taking…', applied: 'Taken' },
    labelPrinted: {
      apply: 'Record print',
      applying: 'Recording…',
      applied: 'Print recorded',
    },
    matchLocations: {
      apply: 'File samples',
      applying: 'Filing…',
      applied: 'Samples filed',
    },
    positionStatus: {
      apply: 'Change position',
      applying: 'Changing…',
      applied: 'Position changed',
    },
    scan: {
      apply: 'Record found',
      applying: 'Recording…',
      applied: 'Recorded',
    },
    resolve: { apply: 'Settle it', applying: 'Settling…', applied: 'Settled' },
    cancel: {
      apply: 'Cancel stocktake',
      applying: 'Cancelling…',
      applied: 'Cancelled',
    },
    dispatch: { apply: 'Mark as sent', applying: 'Sending…', applied: 'Sent' },
    save: { apply: 'Save changes', applying: 'Saving…', applied: 'Saved' },
  },
} as const
