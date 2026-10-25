import { z } from 'zod'

import type { DataClient } from './data-client'

/**
 * Workspace AI access flags.
 *
 * These are coarse, owner-controlled switches over the AI surfaces. They can
 * only reduce what the caller's scopes, workspace role and PostgreSQL RLS
 * already allow; they never grant access and are not a permission system.
 * They are deliberately separate from `SHEETBASE_CAPABILITIES`, which records
 * deployment capability gaps rather than workspace preferences.
 *
 * The `ai_enabled` setting remains the master kill switch. A flag of `true`
 * cannot turn AI on when `ai_enabled` is false.
 */

export const AI_FEATURE_FLAG_KEYS = [
  'assistant',
  'mcp_read',
  'mcp_draft',
  'mcp_workflow',
  'mcp_admin_read',
  'mcp_admin_propose',
] as const

export type AiFeatureFlagKey = (typeof AI_FEATURE_FLAG_KEYS)[number]

export type AiFeatureFlags = Record<AiFeatureFlagKey, boolean>

export interface AiFeatureFlagDefinition {
  key: AiFeatureFlagKey
  label: string
  description: string
  defaultValue: boolean
  risk: 'standard' | 'privileged'
}

export const AI_FEATURE_FLAGS: readonly AiFeatureFlagDefinition[] = [
  {
    key: 'assistant',
    label: 'In-app assistant',
    description:
      'Members can ask grounded questions in the assistant panel and the page entry points.',
    defaultValue: true,
    risk: 'standard',
  },
  {
    key: 'mcp_read',
    label: 'MCP reads and context',
    description:
      'Connected agents can use read and context tools on objects the caller can already read.',
    defaultValue: true,
    risk: 'standard',
  },
  {
    key: 'mcp_draft',
    label: 'MCP drafts and proposals',
    description:
      'Connected agents can propose schema, sheet, pipeline and Dataset changes. Nothing executes without the existing approval path.',
    defaultValue: true,
    risk: 'standard',
  },
  {
    key: 'mcp_workflow',
    label: 'MCP agent workflows',
    description:
      'Connected agents can create and advance bounded workflows. Workflows can auto-execute safe drafts under the caller’s permissions.',
    defaultValue: false,
    risk: 'privileged',
  },
  {
    key: 'mcp_admin_read',
    label: 'MCP administration reads',
    description:
      'A personal owner, admin or steward token can read workspace administration metadata.',
    defaultValue: false,
    risk: 'privileged',
  },
  {
    key: 'mcp_admin_propose',
    label: 'MCP administration proposals',
    description:
      'A personal owner token can propose workspace AI policy changes. A live owner session must still approve and execute them.',
    defaultValue: false,
    risk: 'privileged',
  },
]

export function defaultAiFeatureFlags(): AiFeatureFlags {
  return Object.fromEntries(
    AI_FEATURE_FLAGS.map((flag) => [flag.key, flag.defaultValue]),
  ) as AiFeatureFlags
}

/** Fail-closed flags for a caller that could not read the workspace row. */
export function noAiFeatureFlags(): AiFeatureFlags {
  return Object.fromEntries(
    AI_FEATURE_FLAG_KEYS.map((key) => [key, false]),
  ) as AiFeatureFlags
}

/**
 * Resolve stored JSON into the complete flag record. Unknown keys are ignored
 * and a missing or malformed flag takes its catalogue default, so a partial
 * row cannot silently switch a privileged capability on.
 */
export function resolveAiFeatureFlags(value: unknown): AiFeatureFlags {
  const resolved = defaultAiFeatureFlags()
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return resolved
  }
  const stored = value as Record<string, unknown>
  for (const key of AI_FEATURE_FLAG_KEYS) {
    if (typeof stored[key] === 'boolean') resolved[key] = stored[key]
  }
  return resolved
}

const featureFlagsSchema = z
  .object({
    assistant: z.boolean(),
    mcp_read: z.boolean(),
    mcp_draft: z.boolean(),
    mcp_workflow: z.boolean(),
    mcp_admin_read: z.boolean(),
    mcp_admin_propose: z.boolean(),
  })
  .strict()

export const updateAiFeatureFlagsSchema = z
  .object({
    workspaceId: z.string().uuid(),
    featureFlags: featureFlagsSchema,
  })
  .strict()

export type UpdateAiFeatureFlagsInput = z.infer<
  typeof updateAiFeatureFlagsSchema
>

/**
 * Read the workspace's stored flags. The settings row is member-readable and
 * RLS-scoped. A missing row resolves to catalogue defaults; a transport error
 * is the caller's to handle and should fail closed.
 */
export async function readAiFeatureFlags(
  client: DataClient,
  workspaceId: string,
): Promise<AiFeatureFlags> {
  const rows = await client.list<{ ai_feature_flags: unknown }>(
    'workspace_settings',
    `?select=ai_feature_flags&workspace_id=eq.${encodeURIComponent(workspaceId)}&limit=1`,
  )
  return resolveAiFeatureFlags(rows[0]?.ai_feature_flags)
}
