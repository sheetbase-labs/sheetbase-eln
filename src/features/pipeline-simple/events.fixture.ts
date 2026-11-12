/**
 * The change the Inbox item event is delivered from, as the database writes
 * it. The event catalogue test pins it, so an event cannot be declared in
 * `operations.ts` without saying how it is produced.
 */
export const PIPELINE_SIMPLE_EVENT_FIXTURES: ReadonlyArray<{
  name: string
  entityType: string
  operation: string
  payload: Record<string, never>
}> = [
  {
    name: 'pipeline.inbox_item.created',
    entityType: 'pipeline_inbox_item',
    operation: 'create',
    payload: {},
  },
]
