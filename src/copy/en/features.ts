/** Features a record model can switch on (Models > a model > Features). */
export const features = {
  button: 'Features',
  title: 'Features for {name}',
  intro:
    'Switch on extra things records of this model can do. Each one adds its own page or actions where it is used.',
  save: 'Save',
  saving: 'Saving…',
  groups: {
    records: 'Records',
    quality: 'Quality and compliance',
    planning: 'Planning',
  },
  saved: 'Features saved',
  couldNotSave: 'The features could not be saved.',
  loadError: 'The features could not be loaded.',
  campaigns: {
    label: 'Campaigns',
    hint: 'Records of this model can be optimisation campaigns. You say what may vary and what to improve, then work round by round: the next batch of conditions is proposed, laid out as a plate and approved by a person, and the results feed the next round.',
  },
  registry: {
    label: 'Registry',
    hint: 'Records of this model are registered entries: each keeps one number, is checked for repeats before it is added, and can say what it came from. Add a structure field to register compounds.',
  },
  incidentLog: {
    label: 'Incident log',
    hint: 'Records of this model are listed together on the Incidents page, with those of any other model that has this feature.',
  },
  resultLimits: {
    label: 'Result limits',
    hint: 'Number fields can have a lowest and highest acceptable value, so each result shows whether it passes, needs a look or is out of specification.',
  },
  legalHold: {
    label: 'Legal hold',
    hint: 'Records of this model can be frozen by a hold so nobody can archive or delete them. A hold already in place keeps protecting its records even if you switch this off.',
  },
  retention: {
    label: 'Retention',
    hint: 'Say how long records of this model are kept, then archive the ones past that time. Records on a hold are left alone.',
  },
} as const
