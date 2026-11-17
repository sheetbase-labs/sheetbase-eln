/** The changes `plate_run.linked`, `plate_run.unlinked`, `plate_run.measurements_published` and `plate_design.assay_setup_saved` are delivered from, pinned by the event catalogue test. */
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
  {
    name: 'plate_run.measurements_published',
    entityType: 'plate_run',
    operation: 'update',
    payload: { change: 'measurements_published' },
  },
  {
    name: 'plate_design.assay_setup_saved',
    entityType: 'plate_design',
    operation: 'update',
    payload: { change: 'assay_setup_saved' },
  },
]
