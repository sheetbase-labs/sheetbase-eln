/** The change `protocol.imported` is delivered from, pinned by the event catalogue test. */
export const PROTOCOL_IMPORT_EVENT_FIXTURES: ReadonlyArray<{
  name: string
  entityType: string
  operation: string
  payload: Record<string, never>
}> = [
  {
    name: 'protocol.imported',
    entityType: 'protocol_import',
    operation: 'create',
    payload: {},
  },
]
