/** Extensions: Settings → Extensions, and what extensions add where people work. */
export const extensions = {
  admin: {
    title: 'Extensions',
    intro:
      'An extension adds work to this lab: steps pipelines can take, tools the assistant and other agents can use, and ways to analyse data. Only administrators add them, and each part can be switched off on its own.',
    onlyAdmins: 'Only administrators can manage extensions',
    onlyAdminsBody:
      'Ask an administrator of this workspace to add or change extensions.',
    add: 'Add an extension',
    loadError: 'The extensions could not be loaded.',
    emptyTitle: 'No extensions yet',
    emptyBody:
      'Add one to give pipelines, the assistant or the analysis studio something new to do.',
    columns: {
      extension: 'Extension',
      source: 'From',
      status: 'Status',
      adds: 'What it adds',
      actions: 'Actions',
    },
    status: {
      installed: 'Added, not on',
      enabled: 'On',
      disabled: 'Off',
    },
    points: {
      'pipeline-actions': 'Pipeline actions',
      'assistant-tools': 'Assistant tools',
      'analysis-kinds': 'Analyses',
    },
    pointHint: {
      'pipeline-actions':
        'Steps a pipeline can take after its data is ready.',
      'assistant-tools':
        'Tools the assistant and other agents can use. Anything that changes something waits for a person.',
      'analysis-kinds': 'Ways to analyse a dataset, next to the built-in ones.',
    },
    pointSwitch: 'Switch {point} on or off for {name}',
    pointSwitchedOn: '{point} switched on',
    pointSwitchedOff: '{point} switched off',
    runs: {
      webhook: 'calls a service',
      python: 'runs Python',
    },
    access: {
      read: 'reads',
      write: 'asks first',
    },
    turnOn: 'Switch on',
    turnOff: 'Switch off',
    remove: 'Remove',
    removeTitle: 'Remove {name}?',
    removeBody:
      'Its pipeline actions, assistant tools and analyses stop working straight away. A pipeline that uses one of its actions will fail until another action takes its place.',
    removeConfirm: 'Remove extension',
    removed: '{name} removed',
    enabled: '{name} switched on',
    disabled: '{name} switched off',
    couldNotChange: 'That could not be changed.',
    key: {
      make: 'Make signing key',
      replace: 'Replace signing key',
      hint: 'The key your service uses to check a call came from this workspace.',
      title: 'Signing key for {name}',
      body: 'Copy this key now and give it to the service. It is shown once. Each call carries a signature made with it; the service checks the signature before it does anything.',
      copy: 'Copy key',
      copied: 'Key copied',
      done: 'Done',
      missing: 'No signing key yet',
      has: 'Signing key made',
      failed: 'The signing key could not be made.',
    },
    install: {
      title: 'Add an extension',
      intro:
        'Paste the extension’s description. Sheetbase checks it before anything is added, and the extension stays off until you switch it on.',
      useSample: 'Use the sample',
      manifestLabel: 'Extension description',
      keyLabel: 'Name in this workspace',
      keyHint: 'Lowercase letters, numbers and hyphens. It is part of each tool’s name, so keep it short.',
      untrusted:
        'This extension isn’t from a web address. I know where it came from and want to add it.',
      problems: 'This can’t be added yet',
      invalidJson: 'That isn’t valid JSON.',
      submit: 'Add',
      adding: 'Adding…',
      added: '{name} added. It is off until you switch it on.',
      failed: 'The extension could not be added.',
      cancel: 'Cancel',
    },
  },
  analysis: {
    heading: 'Analyses from extensions',
    intro: 'Choose an analysis, match its inputs to columns, and run it.',
    run: 'Run',
    running: 'Running…',
    pickColumn: 'Choose a column',
    notNeeded: 'Not used',
    resultFrom: 'Result from {name}',
    noRows: 'The analysis returned no rows.',
    failed: 'The analysis could not run: {reason}',
    needsDataset: 'Choose a dataset first.',
    needsInputs: 'Match every required input to a column.',
    truncated:
      'This dataset is too large to analyse here, so nothing was sent.',
    timing: 'Ran in {ms} ms.',
  },
} as const
