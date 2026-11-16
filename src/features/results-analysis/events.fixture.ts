/** The change `analysis.added_to_notebook` is delivered from, pinned by the event catalogue test. */
export const RESULTS_ANALYSIS_EVENT_FIXTURES: ReadonlyArray<{
  name: string
  entityType: string
  operation: string
  payload: Record<string, never>
}> = [
  {
    name: 'analysis.added_to_notebook',
    entityType: 'analysis_notebook',
    operation: 'create',
    payload: {},
  },
]
