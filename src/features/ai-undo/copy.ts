/** Undo copy, read as `t('features.aiUndo.…')`. */
export const copy = {
  cards: {
    undoChanges: {
      apply: 'Undo these changes',
      applying: 'Undoing…',
      applied: 'Changes undone',
    },
  },
  panel: {
    undo: 'Undo',
    undoTitle: 'Undo what this changed',
    checking: 'Checking what can be undone…',
    intro: 'This will put things back as they were:',
    confirm: 'Undo all of it',
    cancel: 'Keep it',
    working: 'Undoing…',
    done: 'Undone',
    doneCount: {
      one: 'Undone: {count} change put back.',
      other: 'Undone: {count} changes put back.',
    },
    already: 'Nothing left to undo.',
    refusedTitle: 'This cannot be undone',
    refusedLead:
      'Nothing was touched. These are why, and undoing needs every one of them to be clear:',
    failed: 'Could not undo: {reason}',
    open: 'Open',
    from: 'was',
    emptyValue: 'empty',
    toggle: 'Show what would change',
  },
  kinds: {
    record: 'Archive',
    project: 'Archive',
    booking: 'Cancel',
    block: 'Remove',
    fields: 'Put back',
  },
  read: {
    none: 'Nothing the assistant changed can be undone.',
  },
  messages: {
    notFound: 'There is nothing to undo yet.',
    nothingUndoable: 'None of the recent changes can still be undone.',
  },
} as const
