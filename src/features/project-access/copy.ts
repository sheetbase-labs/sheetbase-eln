/** Words on the project access cards, read as `t('features.projectAccess.…')`. */
export const copy = {
  cards: {
    setMember: {
      apply: 'Set access',
      applying: 'Saving…',
      applied: 'Access set',
    },
    removeMember: {
      apply: 'Remove access',
      applying: 'Removing…',
      applied: 'Access removed',
    },
    setRule: {
      apply: 'Save permissions',
      applying: 'Saving…',
      applied: 'Permissions saved',
    },
    removeRule: {
      apply: 'Remove rule',
      applying: 'Removing…',
      applied: 'Rule removed',
    },
    setDefaults: { apply: 'Save', applying: 'Saving…', applied: 'Saved' },
    setRules: {
      apply: 'Save rules',
      applying: 'Saving…',
      applied: 'Rules saved',
    },
    requestEdit: {
      apply: 'Ask for access',
      applying: 'Asking…',
      applied: 'Request sent',
    },
  },
} as const
