/**
 * The experiment header's one primary button, chosen by where the experiment
 * is in its life and by who is looking. Submit and Sign are handed up by the
 * notebook while it is open; everywhere else they are links into it.
 */
export type NextStepKind =
  'start' | 'submit' | 'finish' | 'resume' | 'approve' | 'sign'

export type NextStepRole = 'reader' | 'author' | 'reviewer'

export interface NextStepInput {
  status: string
  locked: boolean
  archived: boolean
  /** Whether the person may change this record at all. */
  canWrite: boolean
  /** Regulated labs submit for review; others may simply finish. */
  regulated: boolean
  /** The experiment's reviewer is the person looking, and not its author. */
  isReviewer: boolean
}

export interface NextStep {
  role: NextStepRole
  /** The one primary button, or none when the next move is someone else's. */
  primary: NextStepKind | null
  /** Buttons that stay beside it but are not the main one. */
  secondary: readonly ('submit' | 'finish' | 'reopen' | 'resume')[]
  /** Approve and Request changes sit in the header for the reviewer. */
  reviewing: boolean
  /** Whether the ⋯ menu offers things only the author does (new run, move,
   * archive, template, booking). A reviewer reads the submitted version. */
  authoring: boolean
}

export function experimentNextStep(input: NextStepInput): NextStep {
  const { status } = input

  if (input.archived || !input.canWrite) {
    // A reader has no next step. A locked, approved record still offers Sign
    // from the notebook, to whoever holds a signature to give.
    return {
      role: 'reader',
      primary: null,
      secondary: [],
      reviewing: false,
      authoring: false,
    }
  }

  if (status === 'in_review' && input.isReviewer) {
    return {
      role: 'reviewer',
      primary: 'approve',
      secondary: [],
      reviewing: true,
      authoring: false,
    }
  }

  const author = (
    primary: NextStepKind | null,
    secondary: NextStep['secondary'] = [],
  ): NextStep => ({
    role: 'author',
    primary,
    secondary,
    reviewing: false,
    authoring: true,
  })

  switch (status) {
    case 'draft':
    case 'planned':
      return author('start')
    case 'in_progress':
      return input.regulated ? author('submit') : author('finish', ['submit'])
    case 'returned':
      return author('submit')
    case 'on_hold':
      return author('resume')
    case 'completed':
      return author(null, ['reopen'])
    case 'approved':
      return author(input.locked ? 'sign' : null)
    default:
      return author(null)
  }
}
