/** Words on the report cards, read as `t('features.reports.…')`. */
export const copy = {
  cards: {
    create: {
      apply: 'Create report',
      applying: 'Creating…',
      applied: 'Report created',
    },
    edit: { apply: 'Save changes', applying: 'Saving…', applied: 'Saved' },
    addSection: {
      apply: 'Add section',
      applying: 'Adding…',
      applied: 'Section added',
    },
    bind: {
      apply: 'Use this evidence',
      applying: 'Attaching…',
      applied: 'Evidence attached',
    },
    removeSection: {
      apply: 'Remove section',
      applying: 'Removing…',
      applied: 'Section removed',
    },
    reorder: {
      apply: 'Reorder',
      applying: 'Reordering…',
      applied: 'Reordered',
    },
    saveSchedule: {
      apply: 'Save schedule',
      applying: 'Saving…',
      applied: 'Schedule saved',
    },
    setActive: { apply: 'Save', applying: 'Saving…', applied: 'Saved' },
    sendNow: {
      apply: 'Send now',
      applying: 'Sending…',
      applied: 'Queued, sent within a minute',
    },
    deleteSchedule: {
      apply: 'Delete schedule',
      applying: 'Deleting…',
      applied: 'Schedule deleted',
    },
  },
} as const
