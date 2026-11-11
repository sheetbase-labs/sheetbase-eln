/** Query keys for one sample's record and its change events. */
export const sampleQueryKey = (recordId: string) =>
  ['ui-port', 'sample', recordId] as const

export const sampleEventsQueryKey = (recordId: string) =>
  ['ui-port', 'sample-events', recordId] as const
