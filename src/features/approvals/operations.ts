/**
 * Approvals: approve or return an approval request, approve, reject or ask for
 * changes on a review. One declaration each gives the token API entry, the MCP
 * action and the SDK methods; the webhook events (`approval.*`, `review.decided`)
 * are already in the event catalogue.
 *
 * Needs a personal token with `reviews:write`: the decision is the person's own,
 * made under their name, and the database applies the same rules as in the app
 * (approver role, assigned reviewer, independence, counts). In a regulated lab
 * these stay with a signed-in session. Signing, certifying, releasing a sample,
 * acknowledging a protocol and deciding an agent action are not operations.
 *
 * Not offered to the assistant or to pipelines: nothing decides for a person
 * without that person asking, so there is no card and no pipeline action.
 */
import { defineOperations, input } from '#/lib/operations/descriptor'

const NOTE = 'A note for the record, in a sentence or two.'

const REVIEW_INPUTS = [
  input('p_submission_id', 'uuid'),
  { ...input('p_note', 'text', false), description: NOTE },
  {
    ...input('p_expected_state', 'text', false),
    description: 'The state you saw, `submitted`. Refused if it has changed.',
  },
  {
    ...input('p_expected_revision_digest', 'text'),
    description:
      'The SHA-256 digest of the revision you read, so you decide on what you saw.',
  },
]

export const APPROVAL_OPERATIONS = defineOperations([
  {
    name: 'approve_approval_request',
    label: 'Approve a request',
    summary: 'Approve an approval request',
    description:
      'Records your approval of a waiting request. You need one of the roles it names, you may not approve your own request when it asks for independence, and it is approved once enough people have. Needs `reviews:write`; in a regulated lab it is made in the app. Returns the request. Sends `approval.approved` once it is fully approved.',
    kind: 'write',
    scope: 'reviews:write',
    inputs: [
      input('p_request_id', 'uuid'),
      { ...input('p_reason', 'text', false), description: NOTE },
    ],
    result: 'row:approval_requests',
  },
  {
    name: 'return_approval_request',
    label: 'Return a request',
    summary: 'Return an approval request with a reason',
    description:
      'Sends a waiting request back to whoever asked, with a reason. Same rules as approving. Needs `reviews:write`; in a regulated lab it is made in the app. Returns the request. Sends `approval.returned`.',
    kind: 'write',
    scope: 'reviews:write',
    inputs: [
      input('p_request_id', 'uuid'),
      { ...input('p_reason', 'text'), description: 'Why it goes back.' },
    ],
    result: 'row:approval_requests',
  },
  {
    name: 'approve_review',
    label: 'Approve a review',
    summary: 'Approve a submitted review',
    description:
      'Approves a revision submitted for review. You must be an assigned reviewer, and decide on the digest you read. Needs `reviews:write`; in a regulated lab it is made in the app. Returns the decision. Sends `review.decided`.',
    kind: 'write',
    scope: 'reviews:write',
    inputs: REVIEW_INPUTS,
    result: 'json',
  },
  {
    name: 'reject_review',
    label: 'Reject a review',
    summary: 'Reject a submitted review',
    description:
      'Rejects a revision submitted for review. Same rules as approving. Needs `reviews:write`; in a regulated lab it is made in the app. Returns the decision. Sends `review.decided`.',
    kind: 'write',
    scope: 'reviews:write',
    inputs: REVIEW_INPUTS,
    result: 'json',
  },
  {
    name: 'request_changes_on_review',
    label: 'Ask for changes on a review',
    summary: 'Ask for changes on a submitted review',
    description:
      'Sends a revision back for changes, with a note. Same rules as approving. Needs `reviews:write`; in a regulated lab it is made in the app. Returns the decision. Sends `review.decided`.',
    kind: 'write',
    scope: 'reviews:write',
    inputs: REVIEW_INPUTS,
    result: 'json',
  },
])
