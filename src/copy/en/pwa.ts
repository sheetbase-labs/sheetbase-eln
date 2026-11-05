/** Using Sheetbase as an installed app on a phone or desktop. */
export const pwa = {
  install: {
    title: 'Install Sheetbase',
    body: 'Open it from your home screen like any other app, with scanning and timer alerts at the bench.',
    action: 'Install',
    notNow: 'Not now',
    ios: {
      title: 'Add Sheetbase to your Home Screen',
      body: 'In Safari, tap the Share button, then choose Add to Home Screen.',
    },
  },
  share: {
    action: 'Share',
    copied: 'Link copied',
    failed: 'Couldn’t share the link',
  },
  shareTarget: {
    title: 'Add to a notebook',
    subtitle: 'Choose the experiment these should go into.',
    received: 'Received',
    files: {
      one: '{count} file',
      other: '{count} files',
    },
    text: 'Text',
    link: 'Link',
    nothing:
      'Nothing came through. Share a photo, file or link to Sheetbase from another app, or open a file with it.',
    experiment: 'Experiment',
    experimentPlaceholder: 'Choose an experiment…',
    add: 'Add to notebook',
    adding: 'Adding…',
    added: 'Added to {identifier}',
    failed: 'Couldn’t add that to the notebook',
    discard: 'Discard',
    open: 'Open {identifier}',
  },
} as const
