/** People and continuity: handing work over, being away, sign-in by group, passkeys. */
export const people = {
  handover: {
    menu: 'Hand over work',
    title: 'Hand over {name}’s work',
    description:
      'Choose who takes over what {name} still has open. Signed and finished work stays as it is.',
    descriptionSelf:
      'Choose who takes over what you still have open. Signed and finished work stays as it is.',
    recipient: 'Hand over to',
    recipientPlaceholder: 'Choose a colleague',
    work: {
      record: 'Assigned: {kind}',
      recordReviewer: 'Named as reviewer on records',
      task: 'Open tasks',
      review: 'Reviews waiting on them',
      instrument: 'Instruments they look after',
      projectReviewer: 'Default reviewer of projects',
    },
    workColumn: 'Work',
    openColumn: 'Open',
    tableLabel: 'Open work',
    none: 'Nothing open',
    noneBody: '{name} has no open work to hand over.',
    loading: 'Looking for open work…',
    submit: 'Hand over',
    submitting: 'Handing over…',
    done: 'Done',
    handedOver: {
      one: 'Handed over 1 item to {name}',
      other: 'Handed over {count} items to {name}',
    },
    keptNote: {
      one: '1 item stayed because {name} can’t take it, for example work in a project they can’t open or a review they wrote.',
      other:
        '{count} items stayed because {name} can’t take them, for example work in a project they can’t open or a review they wrote.',
    },
    couldNot: 'Couldn’t hand over the work',
    stillHasWork: {
      one: '{name} still has 1 open item.',
      other: '{name} still has {count} open items.',
    },
    handOverFirst: 'Hand over first',
  },
} as const
