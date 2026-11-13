# Approvals API

A **personal token** with `reviews:write` can decide an approval request or a
review as the person it belongs to. It is that person's decision, under their
name, and the database applies the same rules as in the app: the approver role a
request names, being an assigned reviewer, not approving your own work when a
request asks for independence, and how many approvals are needed.

**Not in a regulated lab.** When Regulated lab is on (Settings, General), these
calls answer `42501` and the decision is made in the app, because it needs a
signed-in session. A workspace service credential cannot decide anything: there
is no person behind it.

**Signing is not here.** Signing a revision or a part, certifying a signature,
releasing a sample, acknowledging a protocol and deciding an agent action still
need the person in the app (a fresh password check, or their own card). Nothing
here lets a token sign for anyone. These actions are also not on the assistant
or in pipelines.

Each decision sends its webhook event: `approval.approved` or `approval.returned`
for requests (see [`event-catalogue.md`](event-catalogue.md)) and
`review.decided` for reviews. Over MCP they run through `sheetbase.lab.act`, and
the Python and TypeScript SDKs have them as `client.rpc.<name>` and
`client.rpc("<name>", ...)`.

## Approval requests

### `approve_approval_request`

Approve an approval request. Records your approval of a waiting request. You need one of the roles it names, and it is approved once enough people have.

Scope: `reviews:write`. Returns `row:approval_requests`.

| Parameter      | Type | Required | Notes                         |
| -------------- | ---- | -------- | ----------------------------- |
| `p_request_id` | uuid | yes      |                               |
| `p_reason`     | text | no       | A note, in a sentence or two. |

### `return_approval_request`

Return an approval request with a reason. Sends a waiting request back to whoever asked.

Scope: `reviews:write`. Returns `row:approval_requests`.

| Parameter      | Type | Required | Notes             |
| -------------- | ---- | -------- | ----------------- |
| `p_request_id` | uuid | yes      |                   |
| `p_reason`     | text | yes      | Why it goes back. |

## Reviews

Each takes the digest of the revision you read, so you decide on what you saw.
Read it with `preview_submission_digest`.

### `approve_review`

Approve a submitted review. You must be an assigned reviewer.

Scope: `reviews:write`. Returns `json`.

| Parameter                    | Type | Required | Notes                                                  |
| ---------------------------- | ---- | -------- | ------------------------------------------------------ |
| `p_submission_id`            | uuid | yes      |                                                        |
| `p_expected_revision_digest` | text | yes      | The SHA-256 digest of the revision you read.           |
| `p_note`                     | text | no       | A note, in a sentence or two.                          |
| `p_expected_state`           | text | no       | The state you saw, `submitted`. Refused if it changed. |

### `reject_review`

Reject a submitted review. Same arguments and rules as `approve_review`.

Scope: `reviews:write`. Returns `json`.

### `request_changes_on_review`

Ask for changes on a submitted review. Same arguments and rules as
`approve_review`.

Scope: `reviews:write`. Returns `json`.
