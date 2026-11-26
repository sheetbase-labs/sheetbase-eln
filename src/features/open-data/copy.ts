/** Words on the ontology and publishing cards, read as `t('features.openData.…')`. */
export const copy = {
  cards: {
    linkTerm: { apply: 'Link term', applying: 'Linking…', applied: 'Linked' },
    unlinkTerm: {
      apply: 'Unlink term',
      applying: 'Unlinking…',
      applied: 'Unlinked',
    },
    saveTarget: { apply: 'Save', applying: 'Saving…', applied: 'Saved' },
    deleteTarget: {
      apply: 'Remove repository',
      applying: 'Removing…',
      applied: 'Removed',
    },
    discard: {
      apply: 'Discard',
      applying: 'Discarding…',
      applied: 'Discarded',
    },
    retry: { apply: 'Try again', applying: 'Retrying…', applied: 'Retrying' },
  },
} as const
