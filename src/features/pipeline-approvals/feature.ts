/**
 * Publishing a pipeline needs an admin's approval, and the Activity tab keeps
 * who changed what and when. The approval itself is the generic approval
 * request (`object_kind` `pipeline_definition_version`), so its events are
 * the `approval.*` events in the core catalogue, and `approval_requests` is
 * already on the token API.
 */
import { defineFeature } from '../define'
import { PIPELINE_APPROVAL_OPERATIONS } from './operations'

export const feature = defineFeature({
  name: 'pipeline-approvals',
  operations: PIPELINE_APPROVAL_OPERATIONS,
  notExposed: {
    approve_approval_request:
      'Approving is an owner’s or admin’s own decision in the app: for a pipeline version, the approval publishes it. A token, MCP or a pipeline step cannot approve, so nothing publishes itself.',
    return_approval_request:
      'Returning a request for changes is the approver’s own decision in the app.',
  },
})
