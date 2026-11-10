import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import { createDataClient } from './data-client'
import { readSignaturePolicy } from './signature-certification'
import type { SignaturePolicy } from './signature-certification'
import { adminQueryKeys, fetchWorkspaceSettings } from './workspace-admin'

const dataClient = createDataClient()

/** The workflow and reviewer count the database falls back to. */
const DEFAULT_REVIEW_WORKFLOW = 'default-scientific-review'
const DEFAULT_MIN_REVIEWERS = 1

/** What a workspace pins for review, with the defaults the database uses. */
export interface ReviewWorkflow {
  enabled: boolean
  workflow: string
  minReviewers: number
}

/** The signature meanings and review workflow a screen needs at once. */
export interface SignaturePolicySettings {
  policy: SignaturePolicy
  reviewWorkflow: ReviewWorkflow
}

/**
 * The stored `review_workflow_config` JSONB column. Each field falls back on
 * its own, so one bad count never discards a pinned workflow.
 */
const reviewWorkflowConfigSchema = z.object({
  workflow: z.string().catch(DEFAULT_REVIEW_WORKFLOW),
  minReviewers: z.coerce.number().int().min(1).catch(DEFAULT_MIN_REVIEWERS),
})

/**
 * Which signature meanings the workspace has switched on. Every meaning is on
 * until the settings say otherwise, so signing is never held up while they load.
 */
export function useSignaturePolicy(
  workspaceId: string | undefined,
): SignaturePolicySettings {
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
): ReviewWorkflow {
  const parsed = reviewWorkflowConfigSchema.safeParse(
    settings?.reviewWorkflowConfig,
  )

  const config = parsed.success
    ? parsed.data
    : { workflow: DEFAULT_REVIEW_WORKFLOW, minReviewers: DEFAULT_MIN_REVIEWERS }

  return {
    enabled: settings?.reviewWorkflowEnabled ?? false,
    workflow: config.workflow,
    minReviewers: config.minReviewers,
  }
}
