/** Words for pipeline connections and the web call step, read as `t('features.pipelineConnections.…')`. */
export const copy = {
  config: {
    needsSettings: 'A web call step needs its settings.',
    needsConnection: 'Choose the connection this web call uses.',
    needsMethod: 'A web call is a GET or a POST.',
    needsPath: 'The path starts with / and has no spaces, such as /batches.',
    needsSecretName: 'A secret is named with letters, digits and _.',
    needsItemsPath: 'Where the rows are is a path such as data.items.',
    getHasNoBody: 'A GET web call sends no body.',
    bodyIsObject: 'The body is a JSON object.',
    unknownParameter:
      'The path or body uses the setting “{name}”, which this pipeline does not have.',
  },
  kind: {
    label: 'Web call',
    hint: 'Ask another system for data',
    group: 'Connect',
  },
  cards: {
    addConnection: {
      apply: 'Add connection',
      applying: 'Adding…',
      applied: 'Connection added',
    },
    changeConnection: {
      apply: 'Save connection',
      applying: 'Saving…',
      applied: 'Connection saved',
    },
    removeConnection: {
      apply: 'Remove connection',
      applying: 'Removing…',
      applied: 'Connection removed',
    },
  },
  settings: {
    title: 'Pipeline connections',
    hint: 'The places pipeline steps may reach: web addresses for web calls and clusters for remote jobs. A step names a connection and a secret; it never holds the secret’s value.',
    add: 'Add connection',
    addTitle: 'Add a pipeline connection',
    addAction: 'Add connection',
    dialogHint:
      'Only this address can be called. Redirects elsewhere, loopback and link-local addresses are refused.',
    name: 'Name',
    namePlaceholder: 'LIMS',
    secretPlaceholder: 'LIMS_READ_TOKEN',
    key: 'Key',
    keyHint: 'What steps call it: lowercase letters, digits and hyphens.',
    address: 'Address',
    addressHint: 'An https address, with no password, query or fragment.',
    addressHintHpc:
      'The address of the cluster’s Slurm REST service (slurmrestd), reachable from Sheetbase.',
    type: 'Type',
    typeWeb: 'Web call',
    typeHpc: 'HPC cluster',
    user: 'Cluster user',
    queues: 'Queues',
    queuesPlaceholder: 'hpc-short:60, gpu.a100:2880',
    queuesHint:
      'Separate with commas. Add the longest job a queue takes, in minutes, after a colon: hpc-short:60, gpu.a100:2880',
    queuesInvalid:
      'Queue names are lowercase letters, digits, dots, underscores and hyphens, each with an optional limit in minutes.',
    callbackUrl: 'Address jobs call back on',
    callbackUrlHint:
      'Leave empty to use this app’s own address. Set it when the cluster reaches Sheetbase another way.',
    secretsHintHpc:
      'The scheduler token is a secret too, usually HPC_SUBMIT_KEY. It is sealed when you save it; nobody can read it back, and only the run that sends a job uses it.',
    description: 'What it is for',
    secrets: 'Secrets',
    secretsHint:
      'Values are sealed when you save them. Nobody can read one back, and only the run that calls ever uses it. Set one again to rotate it.',
    secretsAfter: 'Add the connection first, then store its secrets.',
    noSecrets: 'No secrets stored',
    valueHidden: 'value hidden',
    secretName: 'Secret name',
    secretValue: 'Value',
    set: 'Store secret',
    rotate: 'Rotate secret',
    deleteSecret: 'Delete secret {name}',
    status: 'Status',
    on: 'On',
    off: 'Off',
    switchOn: 'Switch on',
    switchOff: 'Switch off',
    save: 'Save',
    remove: 'Remove',
    removeTitle: 'Remove {name}?',
    removeBody:
      'Its stored secrets are deleted too. A published pipeline that still calls it stops this.',
    loading: 'Loading connections…',
    none: 'No connection is approved yet.',
  },
  editor: {
    connection: 'Connection',
    chooseConnection: 'Choose a connection',
    offSuffix: '{name} (switched off)',
    noConnections: 'No connection is approved yet.',
    manage: 'Approve one in Settings',
    ask: 'Ask',
    method: 'Method',
    path: 'Path',
    body: 'Body (JSON)',
    bodyBroken: 'The body is not a JSON object yet.',
    secret: 'Secret',
    noSecret: 'No secret',
    rowsAt: 'Rows at',
    limits:
      'The secret is named here, never held here: an administrator keeps its value in Settings. A call takes up to 20 s, tries 3 more times when it fails, and its answer is recorded so a Reproduce reads it again instead of asking.',
  },
  step: {
    summary: '{method} {path} on {connection}',
  },
  run: {
    notHttps: 'A web call goes to an https address only.',
    forbiddenHost:
      'A web call cannot go to this computer or to a link-local address.',
    outsideBase: 'The path leads outside the address of its connection.',
    tooLarge: 'The answer is larger than a web call may take (8 MiB).',
    redirected:
      '{connection} sent the call somewhere else, which a web call does not follow.',
    answered: '{connection} answered {status}.',
    unreachable: '{connection} could not be reached after trying again.',
    noConnection: 'There is no connection called “{connection}”.',
    connectionOff: 'The connection {connection} is switched off.',
    noSecret:
      'The connection {connection} has no secret called “{secret}”. An administrator sets it in Settings.',
    notJson: '{connection} did not answer with JSON.',
    noRows: 'The answer has nothing at “{path}”.',
    requestChanged:
      'Step {step} would now ask for something other than it asked for in the run.',
    notRecorded: 'The run did not record an answer for step {step}.',
    trialPost:
      'A try does not send a POST. Run the pipeline once, then step {step} can use the answer it recorded.',
  },
} as const
