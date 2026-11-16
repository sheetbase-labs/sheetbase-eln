/** The changes the AI preference events are delivered from, pinned by the event catalogue test. */
export const AI_PREFERENCE_EVENT_FIXTURES: ReadonlyArray<{
  name: string
  entityType: string
  operation: string
  payload: Record<string, never>
}> = [
  {
    name: 'ai.preference.saved',
    entityType: 'ai_preference',
    operation: 'create',
    payload: {},
  },
  {
    name: 'ai.preference.updated',
    entityType: 'ai_preference',
    operation: 'update',
    payload: {},
  },
  {
    name: 'ai.preference.deleted',
    entityType: 'ai_preference',
    operation: 'delete',
    payload: {},
  },
]
