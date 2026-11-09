/**
 * Words for the experiments feature, read as `t('features.experiments.…')`.
 * `cards` holds the buttons on the assistant's experiment, alias, plan and
 * label template cards.
 */
export const copy = {
  cards: {
    startExperiment: {
      apply: 'Start experiment',
      applying: 'Starting…',
      applied: 'Experiment started',
    },
    setExperimentStatus: {
      apply: 'Change status',
      applying: 'Changing…',
      applied: 'Status changed',
    },
    recordOutcome: {
      apply: 'Record outcome',
      applying: 'Recording…',
      applied: 'Outcome recorded',
    },
    deleteDraft: {
      apply: 'Delete draft',
      applying: 'Deleting…',
      applied: 'Draft deleted',
    },
    planFromProject: {
      apply: 'Copy plan',
      applying: 'Copying…',
      applied: 'Plan copied',
    },
    addAlias: {
      apply: 'Add name',
      applying: 'Adding…',
      applied: 'Name added',
    },
    removeAlias: {
      apply: 'Remove name',
      applying: 'Removing…',
      applied: 'Name removed',
    },
    archiveLabelTemplate: {
      apply: 'Save',
      applying: 'Saving…',
      applied: 'Saved',
    },
  },
} as const
