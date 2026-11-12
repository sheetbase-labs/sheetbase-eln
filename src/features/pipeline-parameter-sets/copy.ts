/** Parameter set copy, read as `t('features.pipelineParameterSets.…')`. */
export const copy = {
  cards: {
    saveParameterSet: {
      apply: 'Save set',
      applying: 'Saving…',
      applied: 'Set saved',
    },
    deleteParameterSet: {
      apply: 'Delete set',
      applying: 'Deleting…',
      applied: 'Set deleted',
    },
  },
  page: {
    title: 'Parameter sets',
    pipelines: 'Pipelines',
    intro:
      'A set is a list of parameters kept once and included by name in any pipeline. A version that includes one keeps its own copy, so changing a set never changes a version already saved.',
    newSet: 'New set',
    editSet: 'Edit set',
    colKey: 'Key',
    colName: 'Name',
    colParameters: 'Parameters',
    colUpdated: 'Updated',
    none: 'No parameters yet',
    empty: 'No parameter sets yet.',
    loading: 'Loading parameter sets',
    failed: 'The parameter sets could not be loaded.',
    name: 'Name',
    key: 'Key',
    keyHint:
      'Lower-case letters, digits, - and _. A file includes the set by this.',
    keyBad: 'Use lower-case letters, digits, - and _, starting with a letter.',
    nameNeeded: 'Give the set a name.',
    description: 'What it is for',
    optional: 'Optional',
    parametersLabel: 'Parameters',
    save: 'Save set',
    saving: 'Saving…',
    cancel: 'Cancel',
    edit: 'Edit',
    delete: 'Delete',
    deleteTitle: 'Delete {name}?',
    deleteBody:
      'Versions that include it keep their copy of its parameters. This cannot be undone.',
    deleteConfirm: 'Delete set',
    saved: 'Set saved',
    deleted: 'Set deleted',
    readOnly: 'Only stewards, admins and owners can change parameter sets.',
    usedIn: 'Include it in a version file with `include: [{key}]`.',
  },
} as const
