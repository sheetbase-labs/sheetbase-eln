/** Plugins: Settings → Plugins, and what plugins add where people work. */
export const plugins = {
  admin: {
    title: 'Plugins',
    intro:
      'A plugin adds work to this lab: things the assistant and other agents can do, steps pipelines can take, and ways to analyse data. Its code runs in an isolated Python sandbox with no network. Only owners and administrators add plugins, and each part can be switched off on its own.',
    onlyAdmins: 'Only owners and administrators can manage plugins',
    onlyAdminsBody:
      'Ask an owner or administrator of this workspace to add or change plugins.',
    add: 'Add a plugin',
    loadError: 'The plugins could not be loaded.',
    emptyTitle: 'No plugins yet',
    emptyBody:
      'Add one to give pipelines, the assistant or the analysis studio something new to do.',
    columns: {
      plugin: 'Plugin',
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
      operations: 'Operations',
      'analysis-kinds': 'Analyses',
    },
    pointHint: {
      operations:
        'Things the assistant, agents, pipelines and the API can ask this plugin to do. Anything that changes something waits for a person.',
      'analysis-kinds': 'Ways to analyse a dataset, next to the built-in ones.',
    },
    pointSwitch: 'Switch {point} on or off for {name}',
    pointSwitchedOn: '{point} switched on',
    pointSwitchedOff: '{point} switched off',
    access: {
      read: 'reads',
      write: 'asks first',
      analysis: 'analysis',
    },
    by: 'by {author}',
    turnOn: 'Switch on',
    turnOff: 'Switch off',
    remove: 'Remove',
    removeTitle: 'Remove {name}?',
    removeBody:
      'Its operations and analyses stop working straight away, and its code is deleted. A pipeline that uses one of its actions will fail until another action takes its place.',
    removeConfirm: 'Remove plugin',
    removed: '{name} removed',
    enabled: '{name} switched on',
    disabled: '{name} switched off',
    couldNotChange: 'That could not be changed.',
    install: {
      title: 'Add a plugin',
      intro:
        'Choose the plugin file you were given. Sheetbase reads it and shows what it does before anything is added, and the plugin stays off until you switch it on.',
      choose: 'Choose a plugin file',
      chooseHint: 'A .sbplugin file, up to 4 MB.',
      reading: 'Reading {file}…',
      chooseAnother: 'Choose a different file',
      problems: 'This file can’t be added',
      readFailed: 'That file could not be read.',
      asks: 'What it asks for',
      asksCode:
        'Runs its own Python code in an isolated sandbox: no network, no access to your data except what it is given in each call.',
      asksScopes: 'Declared access: {scopes}.',
      asksNothing: 'It reads nothing beyond what each call gives it.',
      adds: 'What it adds',
      addsNothing: 'Nothing',
      newVersion: 'Replaces version {version}',
      newVersionBody:
        'Updating switches the plugin off until you have looked at it again.',
      changesAdded: 'New: {items}',
      changesRemoved: 'Dropped: {items}',
      files: '{count} files, {size}',
      trust:
        'I have read what this plugin does and I trust where it came from.',
      submit: 'Add plugin',
      submitUpdate: 'Update plugin',
      adding: 'Adding…',
      added: '{name} added. It is off until you switch it on.',
      updated: '{name} updated to {version}. It is off until you switch it on.',
      failed: 'The plugin could not be added.',
      cancel: 'Cancel',
    },
  },
  analysis: {
    heading: 'Analyses from plugins',
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
