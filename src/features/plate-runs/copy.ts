/**
 * Words for plate runs in experiments, read as `t('features.plateRuns.…')`:
 * the plate run notebook block, the dialog's experiment and file fields, the
 * experiment's Plates tab, the experiment link on a run and the assistant card.
 */
export const copy = {
  block: {
    label: 'Plate run',
    description:
      'A plate run, live: the plate map, Z′, hits and potencies beside your results.',
    noRun: 'No plate run chosen yet',
    loading: 'Loading the plate run…',
    unavailable:
      'This plate run isn’t available. It may have been archived, or you may not have access to it.',
    pinnedFrozen:
      'The result as it stood when this notebook was submitted. Later changes to the plate run don’t appear here.',
    pinnedUnavailable:
      'The plate run can’t be read, so this is the result as it was last saved here.',
    addTitle: 'Add the reader’s file',
    addHint:
      'Drop the CSV or Excel file the plate reader wrote. You’ll see the plate and its quality before anything is saved.',
    pickTitle: 'Use a plate run you already have',
    pickHint:
      'Pick one from the Plates page. It joins this experiment, and its results show here.',
    pickPlaceholder: 'Choose a plate run…',
    inAnotherExperiment: 'Already in another experiment',
    couldNotSave: 'The plate run couldn’t be added to this block.',
    openRun: 'Open plate run',
    changeRun: 'Use a different plate run',
    keepRun: 'Keep this plate run',
    live: 'Live from the plate run',
  },
  summary: {
    hits: 'Hits',
    hitsOf: '{hits} of {tested}',
    readWells: 'Wells read',
    hitsTitle: 'Hits',
    noHits: 'No sample is a hit under the current rule.',
    curvesTitle: 'Potency',
    potency: 'EC50',
    rSquared: 'R²',
    seeAll: 'See every sample on the plate run',
    notAnalysed:
      'This plate hasn’t been analysed yet. Open the plate run to check the controls and analyse it.',
  },
  form: {
    drop: 'Drop the plate reader file here',
    dropHint: 'CSV, TSV or Excel (.xlsx). Grids and well lists both work.',
    whichPlate: 'Plate in this file',
    candidate: '{label} · {readings} readings',
    columnsGuessed:
      'Filled in from the plate: these two columns read as two tight groups far apart. Change them if they are not your controls.',
    noPlateInFile:
      'No plate found in that file. Look for a grid with columns 1, 2, 3… and rows A, B, C…, or a list with a well column.',
    unreadable: 'That file couldn’t be read.',
    experiment: 'Experiment',
    experimentHint:
      'The plate run belongs to the experiment, and its results show in the notebook.',
    experimentFixed: 'The plate run is added to this experiment.',
    noExperiment: 'Not in an experiment',
    addToNotebook: 'Show it in the experiment’s notebook',
    createdInNotebook: '{reference} added to the experiment.',
    notebookNotUpdated:
      'The plate run was added, but the notebook couldn’t be updated. Add a plate run block there to show it.',
    negativeColumns: 'Negative control columns',
    positiveColumns: 'Positive control columns',
    columnsHint:
      'For a grid with no layout: the columns that hold the controls, such as 1 and 12. They give you Z′ and hits.',
    noControlsYet:
      'No controls yet, so there’s no Z′. Name the control columns above, or add a layout.',
  },
  step: {
    label: 'Step',
    hint: 'The plate goes in this step of the notebook, straight after it, and the step reads in progress.',
    none: 'No step: the end of the notebook',
    option: '{number}. {text}',
    inStep: 'Step {number} · {text}',
    added: '{reference} added to step {number}.',
    markDone: 'Mark step done',
    platesOf: '{count} of {expected} plates',
    plates: '{count} plates',
    addPlate: 'Add plate',
    stepDone: 'Step {number} done.',
    couldNotFinish: 'The step couldn’t be marked done.',
  },
  fill: {
    title: 'Plate map from the experiment’s samples',
    hint: 'This experiment has {count} samples. Fill the plate from them and each well names its sample, so a result reaches the sample it measured.',
    replicates: 'Wells per sample',
    direction: 'Fill',
    across: 'Across the rows',
    down: 'Down the columns',
    blanks: 'Blank wells',
    top: 'Top standard',
    unit: 'Unit',
    fold: 'Fold dilution',
    points: 'Standards',
    standardReplicates: 'Wells per standard',
    fill: 'Fill the plate with {count} samples',
    left: '{count} samples did not fit, from {first} on.',
  },
  sampleResults: {
    title: 'Read from plates',
    hint: 'What plate runs read off their standard curves for this sample, dilution already applied.',
    name: 'Assay',
    result: 'Result',
    plate: 'Plate',
    note: 'How',
    measured: 'Read',
  },
  quantify: {
    preview: '{wells} wells read, {standards} standards, {samples} samples',
    tabs: {
      results: 'Results',
      standards: 'Standard curve',
    },
    method: 'Read the plate by',
    methodHint:
      'A screen calls hits against the plate’s controls. Quantify reads each sample off a standard curve fitted to the plate’s standards.',
    methods: {
      screen: 'Screen: hits against controls',
      quantify: 'Quantify: standard curve',
    },
    dilutionFactor: 'Samples diluted',
    dilutionFactorHint:
      'The fold dilution put back on each reading, unless a well says its own. 1 means neat.',
    r2Min: 'Standard curve passes at R² of',
    r2Passes: 'Standard curve passes at R² of {r2}',
    neat: 'Samples read neat',
    dilutedBy: 'Samples diluted {factor}-fold',
    r2: 'Standard curve R²',
    samplesRead: 'Samples read',
    standards: 'Standards',
    summary: '{count} samples read off the standard curve, R² {r2}.',
    sample: 'Sample',
    result: 'Result',
    reading: 'Reading',
    dilution: 'Dilution',
    wells: 'Wells',
    cv: 'CV',
    status: {
      ok: 'In range',
      below_range: 'Below the standards',
      above_range: 'Above the standards',
      no_signal: 'No reading',
      no_curve: 'No curve',
    },
    partlyOutOfRange: 'Some wells fell outside the standards and are left out.',
    failure: {
      no_standards:
        'No standards on this plate. Give the wells that hold them the role “standard” and their concentration.',
      too_few_standards:
        'Not enough different standard concentrations to fit this curve. A 4-parameter curve needs four, a 5-parameter curve five.',
      fit_failed:
        'The standard curve could not be fitted. Check the standards’ readings and concentrations.',
    },
    curveTitle: 'Standard curve: {model}',
    curveLabel: 'Standard curve with the samples read off it',
    standardsTable: 'Standards',
    standardConc: 'Concentration',
    standardReading: 'Mean reading',
    standardWells: 'Wells',
    publish: 'Give results to the samples',
    published: '{count} samples now show this result.',
    publishedSome:
      '{count} samples now show this result. {skipped} had none to give.',
    couldNotPublish: 'The results couldn’t be given to the samples.',
    publishHint:
      'Each sample’s page shows its result as a measurement, and reading the plate again replaces it.',
    unlinked:
      'Some samples are not linked to a record, so they have no page to show a result on.',
  },
  tab: {
    title: 'Plates',
    empty: 'No plate runs in this experiment yet',
    emptyHint:
      'Drop the plate reader’s file to see the plate, its quality and the hits here.',
    add: 'Add a plate run',
    inNotebook: 'In the notebook',
    notInNotebook: 'Not in the notebook',
    addToNotebook: 'Add to notebook',
    makeWorklist: 'Make a worklist',
    addedToNotebook: 'Added to the notebook.',
    couldNotAdd: 'Couldn’t add it to the notebook.',
    notebook: 'Notebook',
  },
  link: {
    label: 'Experiment',
    none: 'Not in an experiment',
    change: 'Change',
    link: 'Add to an experiment',
    unlink: 'Remove from experiment',
    title: 'Add {reference} to an experiment',
    hint: 'Its plate and results then show in that experiment, and it appears on the experiment’s Plates tab.',
    linked: '{reference} is now in the experiment.',
    unlinked: '{reference} is no longer in an experiment.',
    couldNotLink: 'The plate run couldn’t be moved.',
    save: 'Add to experiment',
  },
  setup: {
    title: 'Setup for {design}',
    remembered:
      'Every plate of this assay is read the same way. Change the control columns below for this plate only.',
    fromLastPlate: 'Taken from the last plate in this experiment.',
    controls: 'Negative control in {negative}, positive in {positive}',
    controlsNone: 'No control columns remembered',
    columnOne: 'column {columns}',
    columnMany: 'columns {columns}',
    normalise: 'Normalise to {what}',
    hitThreshold: 'Hit when {direction} {threshold}',
    hitOther: 'Hit rule: {rule}',
    zPrime: 'Z′ of {zPrime} passes',
    remember:
      'Remember the controls and settings for the next plate of {design}',
    rememberUpdate:
      'Update the setup remembered on {design} with these controls',
    rememberNew: 'Remember this setup as an assay',
    rememberNewHint:
      'Name the assay. The next plate of it is read with these controls and settings, with nothing to type again.',
    rememberNamePlaceholder: 'Assay name, such as PicoGreen',
    rememberDesignName: 'Assay name',
    saved: 'Setup remembered on {design}.',
    couldNotRemember:
      'The plate run was added, but its setup couldn’t be remembered.',
    rememberFromRun:
      'Also remember these settings for the next plate of {design}',
    rememberFromRunNew: 'Remember these settings as an assay',
    rememberFromRunNewHint:
      'Name the assay and point this run at it. The next plate of the assay starts with these settings.',
    noDesign: 'Use the assay’s setup',
    applyDesign: 'Use the setup remembered on the assay',
  },
  compare: {
    title: 'Plates side by side',
    hint: 'Plates analysed in this experiment, newest first.',
    metric: 'Plate',
    quality: 'Quality',
    zPrime: 'Z′',
    signalToBackground: 'Signal to background',
    hits: 'Hits',
    setup: 'Setup',
    sameSetup: 'Same as {design}',
    differentSetup: 'Differs from {design}',
    noDesign: 'No assay design',
    potency: 'EC50',
    sample: 'Sample',
    notFitted: 'Not fitted',
    notAnalysed: 'Not analysed',
    pickHits: 'Pick hits into a new plate',
  },
  drop: {
    title: 'Drop the next plate here',
    hint: 'It is read and analysed with the setup this experiment’s assay remembers. You check the preview, then add it.',
    hintNone:
      'Drop the plate reader’s file to see the plate, its quality and the hits.',
  },
  cards: {
    addToExperiment: {
      apply: 'Add to experiment',
      applying: 'Adding…',
      applied: 'Added to experiment',
    },
    rememberSetup: {
      apply: 'Remember setup',
      applying: 'Remembering…',
      applied: 'Setup remembered',
    },
    publishMeasurements: {
      apply: 'Give results to samples',
      applying: 'Giving…',
      applied: 'Results given to samples',
    },
  },
} as const
