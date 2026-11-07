/**
 * The experiment planner.
 */
export const planner = {
  plans: {
    planWithAi: 'Plan with AI',
  },
  dialog: {
    title: 'Plan with AI',
    goal: 'What do you want to do?',
    goalHint:
      'Say what you want to find out and with what, for example “Dose response of compound X on HEK293 cells, eight doses in triplicate, read on the plate reader”.',
    goalPlaceholder: 'Describe the experiment',
    project: 'Project',
    projectPlaceholder: 'Choose a project',
    draft: 'Draw up a plan',
    reviewTitle: 'Read the plan',
    back: 'Back',
    working: 'Drawing up a plan…',
    cancel: 'Cancel',
    failed: 'The plan could not be drawn up: {message}',
    nothing:
      'Nothing usable came back. Add more detail, such as the cells, the compound and the readout, and try again.',
    advisory:
      'You read the plan first; nothing is created until you press Create experiment.',
  },
  view: {
    goal: 'Goal',
    summary: 'What will be done',
    rationale: 'Why this way',
    experiment: 'Experiment',
    startsFrom: 'Starts from',
    startsBlank: 'A blank experiment',
    parts: 'Parts',
    partsTable: 'Parts of the experiment',
    partColumns: {
      part: 'Part',
      day: 'Day',
      handsOn: 'At the bench',
      wait: 'Wait after',
      instruments: 'Instruments',
    },
    day: 'Day {count}',
    minutes: '{count} min',
    noWait: 'None',
    noInstruments: 'None',
    gate: {
      warn: 'Opens when the part before is done; you can go on with a reason',
      block: 'Opens only when the part before is done',
    },
    noParts: 'No parts: the experiment is created as one piece.',
    plate: 'Plate',
    plateSummary:
      '{format} plate: {samples} sample wells and {controls} control wells.',
    plateNone: 'No plate.',
    worklist: 'Worklist',
    worklistSummary:
      '{count} transfers from “{source}”, as a {format} file for a liquid handler.',
    worklistNone: 'No worklist.',
    samples: 'Samples to set aside',
    samplesTable: 'Samples set aside',
    sampleColumns: { sample: 'Sample', quantity: 'Amount' },
    samplesNone: 'No samples set aside.',
    schedule: 'Schedule',
    scheduleOn:
      'A schedule is asked for on the instruments the parts need. Nothing is booked until you accept it.',
    scheduleOff: 'No schedule is asked for.',
    warnings: 'Check before creating',
    create: 'Create experiment',
    creating: 'Creating…',
    createFailed: 'The experiment could not be created. Nothing was made.',
  },
} as const
