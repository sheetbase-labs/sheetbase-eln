/** Words on the readiness list, the setting and its card, read as `t('features.submitReadiness.…')`. */
export const copy = {
  cards: {
    set: {
      apply: 'Save rule',
      applying: 'Saving…',
      applied: 'Rule saved',
    },
  },
  setting: {
    title: 'Before submission',
    body: 'Protocol steps nobody has finished and a missing decision are listed on every experiment, in the submit dialog and for the reviewer. Choose whether they only warn, or stop the submission.',
    label: 'Open steps and no decision',
    offLabel: 'Not checked',
    offHint: 'Experiments can be submitted with steps open and no decision.',
    warnLabel: 'Warn',
    warnHint: 'They are listed, but the experiment can still be submitted.',
    blockLabel: 'Block',
    blockHint:
      'They are listed, and the experiment cannot be submitted until they are cleared.',
    savedToast: 'Rule saved',
    failedToast: 'Couldn’t save the rule',
  },
  list: {
    openStepsOne: '{count} protocol step is not finished',
    openStepsMany: '{count} protocol steps are not finished',
    openStepDetail: 'Step {number}: {text}',
    noDecision: 'No decision recorded',
    noDecisionDetail:
      'Say whether the results supported the hypothesis, on the Results tab.',
    goToStep: 'Go to step',
    goToDecision: 'Record decision',
  },
} as const
