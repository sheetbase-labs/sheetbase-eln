/**
 * Approvals a personal token may make: deciding an approval request and a
 * review. Signing is not here; it still needs a fresh password check in the app.
 */
import { APPROVAL_OPERATIONS } from './operations'
import { defineFeature } from '../define'

export const feature = defineFeature({
  name: 'approvals',
  operations: APPROVAL_OPERATIONS,
  agentArea: {
    area: 'Approvals',
    match:
      /^(approve|return)_approval_request$|^(approve|reject)_review$|request_changes_on_review/,
    beforeCore: true,
  },
})
