/** Words on the people and client cards, read as `t('features.peopleAdmin.…')`. */
export const copy = {
  cards: {
    reissueInvitation: {
      apply: 'Send again',
      applying: 'Sending…',
      applied: 'New link made',
    },
    revokeSession: {
      apply: 'Sign out',
      applying: 'Signing out…',
      applied: 'Signed out',
    },
    setUsername: { apply: 'Save', applying: 'Saving…', applied: 'Saved' },
    renameClient: {
      apply: 'Rename',
      applying: 'Renaming…',
      applied: 'Renamed',
    },
    archiveClient: { apply: 'Save', applying: 'Saving…', applied: 'Saved' },
    clientMessage: { apply: 'Post', applying: 'Posting…', applied: 'Posted' },
  },
} as const
