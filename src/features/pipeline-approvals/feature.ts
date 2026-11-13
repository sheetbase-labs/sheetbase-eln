/**
 * Publishing a pipeline needs an admin's approval, and the Activity tab keeps
 * who changed what and when. The approval itself is the generic approval
 * request (`object_kind` `pipeline_definition_version`), so its events are
 * the `approval.*` events in the core catalogue, and `approval_requests` is
 * already on the token API. A personal token with `reviews:write` can approve
 * or return one outside a regulated lab (the `approvals` feature).
 */
import { defineFeature } from '../define'
import { PIPELINE_APPROVAL_OPERATIONS } from './operations'

export const feature = defineFeature({
  name: 'pipeline-approvals',
  operations: PIPELINE_APPROVAL_OPERATIONS,
})
