/** Features a record model can switch on (Models > a model > Features). */
export const features = {
  button: 'Features',
  title: 'Features for {name}',
  intro:
    'Switch on extra things records of this model can do. Each one adds its own page or actions where it is used.',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Features saved',
  couldNotSave: 'The features could not be saved.',
  loadError: 'The features could not be loaded.',
  campaigns: {
    label: 'Campaigns',
    hint: 'Records of this model can be optimisation campaigns. You say what may vary and what to improve, then work round by round: the next batch of conditions is proposed, laid out as a plate and approved by a person, and the results feed the next round.',
  },
} as const
