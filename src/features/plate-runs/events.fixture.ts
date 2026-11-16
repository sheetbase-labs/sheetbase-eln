/** The changes `plate_run.linked` and `plate_run.unlinked` are delivered from, pinned by the event catalogue test. */
export const PLATE_RUN_EVENT_FIXTURES: ReadonlyArray<{
  name: string
  entityType: string
  operation: string
  payload: Record<string, string>
}> = [
  {
    name: 'plate_run.linked',
    entityType: 'plate_run',
    operation: 'update',
    payload: { change: 'linked' },
  },
  {
    name: 'plate_run.unlinked',
    entityType: 'plate_run',
    operation: 'update',
    payload: { change: 'unlinked' },
  },
]
