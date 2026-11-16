/** AI preferences copy, read as `t('features.aiPreferences.…')`. */
export const copy = {
  cards: {
    save: {
      apply: 'Remember this',
      applying: 'Saving…',
      applied: 'Remembered',
    },
    update: {
      apply: 'Save change',
      applying: 'Saving…',
      applied: 'Changed',
    },
    forget: {
      apply: 'Forget this',
      applying: 'Removing…',
      applied: 'Forgotten',
    },
  },
  page: {
    title: 'AI preferences',
    subtitle:
      'What the assistant remembers about how you and your lab like things done. It follows these when it plans, and asks before it saves a new one.',
    yours: 'Your preferences',
    yoursHint: 'Only you can see and use these.',
    lab: 'Lab preferences',
    labHint: 'Everyone’s assistant follows these.',
    labViewOnly: 'Only someone who manages the AI settings can change these.',
    add: 'Add preference',
    topic: 'Topic',
    preference: 'Preference',
    updated: 'Updated',
    edit: 'Edit',
    remove: 'Remove',
    removing: 'Removing…',
    empty: 'Nothing saved yet.',
    emptyYours:
      'Nothing saved yet. Tell the assistant how you like things done, such as “blanks go in column 12”, and it will offer to remember it.',
    emptyLab:
      'Nothing saved for the lab yet. Add a standing default, such as a naming pattern or the plate layout everyone uses.',
    loadError: 'Could not load the preferences.',
    tableYours: 'Your preferences',
    tableLab: 'Lab preferences',
    dialogAdd: 'Add a preference',
    dialogEdit: 'Edit preference',
    dialogDescription:
      'One short sentence the assistant can follow, such as “96-well plates: blanks in column 12”.',
    topicPlaceholder: 'Plate layout',
    topicHint: 'Optional. A few words so it is easy to find.',
    bodyPlaceholder: 'Put blanks in column 12 and standards in column 1.',
    save: 'Save',
    saving: 'Saving…',
    cancel: 'Cancel',
    saved: 'Preference saved',
    removed: 'Preference removed',
    couldNotSave: 'Could not save the preference.',
    couldNotRemove: 'Could not remove the preference.',
    labLink: 'Lab preferences are on the AI preferences page.',
  },
  scope: {
    user: 'Only you',
    workspace: 'Everyone in the lab',
  },
}
