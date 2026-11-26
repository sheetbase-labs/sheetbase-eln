/** Words on the automation cards, read as `t('features.automationAdmin.…')`. */
export const copy = {
  cards: {
    save: { apply: 'Save', applying: 'Saving…', applied: 'Saved' },
    delete: { apply: 'Delete', applying: 'Deleting…', applied: 'Deleted' },
    retireVersion: {
      apply: 'Retire version',
      applying: 'Retiring…',
      applied: 'Version retired',
    },
    remind: {
      apply: 'Send reminder',
      applying: 'Sending…',
      applied: 'Reminded',
    },
    repeat: {
      apply: 'Set up repeat',
      applying: 'Setting up…',
      applied: 'Repeat set up',
    },
    replay: {
      apply: 'Send again',
      applying: 'Sending…',
      applied: 'Sent again',
    },
    planSchedule: {
      apply: 'Ask for a plan',
      applying: 'Asking…',
      applied: 'Asked',
    },
    dismissPlan: {
      apply: 'Dismiss plan',
      applying: 'Dismissing…',
      applied: 'Plan dismissed',
    },
    runWatcher: { apply: 'Run now', applying: 'Running…', applied: 'Ran' },
  },
} as const
