import { useQuery } from '@tanstack/react-query'

import { createDataClient } from './data-client'
import { readSignaturePolicy } from './signature-certification'
import type { SignaturePolicy } from './signature-certification'
import { adminQueryKeys, fetchWorkspaceSettings } from './workspace-admin'

const dataClient = createDataClient()

/**
 * Which signature meanings the workspace has switched on. Every meaning is on
 * until the settings say otherwise, so signing is never held up while they load.
 */
export function useSignaturePolicy(workspaceId: string | undefined): {
  policy: SignaturePolicy
  reviewWorkflow: { enabled: boolean; workflow: string; minReviewers: number }
} {
  const settings = useQuery({
    queryKey: adminQueryKeys.settings(workspaceId ?? ''),
    queryFn: () => fetchWorkspaceSettings(dataClient, workspaceId ?? ''),
    enabled: Boolean(workspaceId),
  })
  return {
    policy: readSignaturePolicy(settings.data?.signaturePolicy),
    reviewWorkflow: readReviewWorkflow(settings.data),
  }
}

/** The review workflow a workspace pins, with the defaults the database uses. */
export function readReviewWorkflow(
  settings:
    | { reviewWorkflowEnabled: boolean; reviewWorkflowConfig: unknown }
    | null
    | undefined,
): { enabled: boolean; workflow: string; minReviewers: number } {
  const config =
    settings?.reviewWorkflowConfig &&
    typeof settings.reviewWorkflowConfig === 'object'
      ? (settings.reviewWorkflowConfig as Record<string, unknown>)
      : {}
  const minReviewers = Number(config.minReviewers)
  return {
    enabled: settings?.reviewWorkflowEnabled ?? false,
    workflow:
      typeof config.workflow === 'string'
        ? config.workflow
        : 'default-scientific-review',
    minReviewers:
      Number.isInteger(minReviewers) && minReviewers >= 1 ? minReviewers : 1,
  }
}
