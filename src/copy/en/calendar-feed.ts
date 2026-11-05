/** Calendar subscriptions: the Schedule's bookings in the calendar people already use. */
export const calendarFeed = {
  button: 'Subscribe',
  title: 'Subscribe in your calendar',
  intro:
    'Get bookings in Outlook, Google Calendar or Apple Calendar. The link is private to you: anyone who has it can see these bookings, so keep it to yourself.',
  scope: 'What to show',
  scopes: {
    mine: 'My bookings',
    instrument: 'One instrument',
    all: 'Every booking',
  },
  instrument: 'Instrument',
  name: 'Name in your calendar',
  nameHint: 'Optional. It helps you tell your links apart.',
  create: 'Make link',
  creating: 'Making…',
  couldNotCreate: 'The link couldn’t be made.',
  newLink: 'Your link',
  newLinkHint:
    'Copy it now. It isn’t shown again, but you can make another any time.',
  copy: 'Copy link',
  copied: 'Link copied',
  copyFailed: 'The link couldn’t be copied. Select it and copy it by hand.',
  open: 'Open in your calendar',
  yours: 'Your links',
  columns: {
    name: 'Shows',
    made: 'Made',
    lastUsed: 'Last used',
  },
  neverUsed: 'Not yet',
  revoke: 'Revoke',
  revoked: 'Link revoked',
  couldNotRevoke: 'The link couldn’t be revoked.',
  noneYet: 'You haven’t made a link yet.',
  close: 'Close',
} as const
