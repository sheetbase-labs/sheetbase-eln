/** The qualification list's query key, shared by the page and its mutations. */
export const qualificationQueryKey = (instrumentId: string) =>
  ['ui-port', 'instrument-qualifications', instrumentId] as const
