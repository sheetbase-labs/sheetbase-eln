/** Account and browser basics: tab titles, email, following, logo, leaving. */
export const account = {
  browserTitle: {
    app: 'Sheetbase',
    unread: '({count}) {title}',
    page: '{title} · {app}',
  },
  follow: {
    follow: 'Follow',
    following: 'Following',
    unfollow: 'Unfollow',
    followedToast: 'You’re following this',
    unfollowedToast: 'You’ve stopped following this',
    couldNotChangeToast: 'Couldn’t change your follow',
    followRecordHint:
      'Get notified about new comments. Followed records also appear in your Inbox.',
    followProjectHint:
      'Followed projects appear in your Inbox. You’re added automatically when you comment or are mentioned.',
    followingKind: 'Following',
    projectKind: 'Project you follow',
  },
  email: {
    title: 'Email address',
    change: 'Change',
    changeTitle: 'Change email address',
    changeFor: 'Change email for {name}',
    changeDescription:
      'We’ll send a link to the new address. Your address changes when it’s opened.',
    changeDescriptionAdmin:
      'We’ll send a link to the new address. Their address changes when it’s opened.',
    newAddress: 'New email address',
    send: 'Send confirmation link',
    sending: 'Sending…',
    sentToast: 'Confirmation link sent to {email}',
    sentNote:
      'Check {email} for the link. Your address stays the same until you open it.',
    sentNoteAdmin:
      'A link has gone to {email}. Their address stays the same until it’s opened.',
    noMailTitle: 'Email isn’t set up here',
    noMailBody:
      'Open this link to confirm the new address. Anyone who has it can finish the change, so pass it on carefully.',
    copyLink: 'Copy link',
    linkCopiedToast: 'Link copied',
    refusedInvalid: 'Enter a full email address, such as name@lab.org.',
    refusedSame: 'That’s already the address on this account.',
    refusedTaken: 'Another account already uses that address.',
    refusedUnknown: 'That account couldn’t be found.',
    refusedNoMail:
      'This install can’t send email, so the address can’t be changed here.',
    couldNotSend: 'Couldn’t send the confirmation link',
    confirmedTitle: 'Email address changed',
    confirmedBody:
      'Your address is now {email}. You’ve been signed out everywhere, so sign in again with the new address.',
    signIn: 'Go to sign in',
    invalidTitle: 'This link doesn’t work',
    invalidBody:
      'It may have been used already. Ask for a new link from your profile.',
    expiredTitle: 'This link has expired',
    expiredBody:
      'Links work for one hour. Ask for a new one from your profile.',
    takenTitle: 'That address is now in use',
    takenBody: 'Another account took it before this link was opened.',
    confirming: 'Confirming your new address…',
    requestSubject: 'Confirm your new Sheetbase email address',
    requestBody:
      '{by} asked to change the email address on the Sheetbase account for {name} from {old} to this address.\n\nOpen this link to confirm. It works once and expires in an hour.\n\n{link}\n\nIf you weren’t expecting this, ignore this email; nothing will change.',
    changedSubject: 'Your Sheetbase email address was changed',
    changedBody:
      'The email address on your Sheetbase account was changed to {new}. You can no longer sign in with this address.\n\nIf this wasn’t you, tell your workspace administrator.',
    someone: 'Someone',
    you: 'You',
    yourAdministrator: 'A workspace administrator',
  },
  logo: {
    title: 'Lab logo',
    description:
      'Shown on printed records, PDF reports, client portal pages and the sign-in page. Use a PNG or JPEG under 1 MB.',
    none: 'No logo yet. These pages show the Sheetbase mark.',
    upload: 'Upload logo',
    replace: 'Replace logo',
    remove: 'Remove logo',
    uploading: 'Uploading…',
    uploadedToast: 'Lab logo saved',
    removedToast: 'Lab logo removed',
    tooLarge: 'Choose a logo under 1 MB.',
    wrongType: 'Use a PNG or JPEG image.',
    notAllowed: 'Only an administrator can change the lab logo.',
    couldNotSave: 'Couldn’t save the logo. Try again.',
    previewAlt: 'Your lab’s logo',
  },
  leave: {
    title: 'Leave this workspace',
    description:
      'You’ll lose access to {workspace} and stop getting its notifications. Your past work stays on the record under your name.',
    button: 'Leave workspace',
    confirmTitle: 'Leave {workspace}?',
    confirmBody:
      'An administrator will need to invite you again if you want to come back.',
    confirm: 'Leave workspace',
    leaving: 'Leaving…',
    lastOwner:
      'You’re the only owner. Make someone else an owner in Members before you leave.',
    onlyWorkspace:
      'This is the only workspace you belong to, so you can’t leave it.',
    couldNotLeave: 'Couldn’t leave the workspace. Try again.',
  },
} as const
