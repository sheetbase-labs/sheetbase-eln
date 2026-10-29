import { t } from '#/copy'
/**
 * External credential scope vocabulary (API-01 contract §8).
 *
 * This is the only issuable vocabulary. `scientific:*` is removed, not
 * deprecated. API-07 enforces Core Dataset/Sheet scopes on the
 * external allowlist. File scopes, schema-authoring RPCs, and human
 * attestation (submit / sign / amend / revision checks) stay fail-closed.
 */

export const VALID_SCOPES = [
  'projects:read',
  'projects:write',
  'datasets:read',
  'datasets:write',
  'schema:read',
  'schema:write',
  'schema:publish',
  'sheets:read',
  'sheets:write',
  'models:read',
  'models:write',
  'templates:read',
  'templates:write',
  'reviews:read',
  'reviews:write',
  'files:read',
  'files:write',
  'webhooks:read',
  'webhooks:write',
  'agent_operations:read',
  'agent_operations:write',
  'pipelines:read',
  'pipelines:write',
  'admin:read',
  'admin:write',
] as const

export type Scope = (typeof VALID_SCOPES)[number]

export function isValidScope(scope: string): scope is Scope {
  return (VALID_SCOPES as readonly string[]).includes(scope)
}

/** Admin UI grouping. `effective` means the current external allowlist honours it. */
export const SCOPE_GROUPS: ReadonlyArray<{
  title: string
  description: string
  effective: boolean
  personalOnly?: boolean
  scopes: readonly Scope[]
}> = [
  {
    title: t('settings.apiScopes.projects'),
    description: t('settings.apiScopes.currentlyEnforcedExternalDescription'),
    effective: true,
    scopes: ['projects:read', 'projects:write'],
  },
  {
    title: t('settings.apiScopes.datasetsData'),
    description: t('settings.apiScopes.queryCommitSnapshotDescription'),
    effective: true,
    scopes: ['datasets:read', 'datasets:write'],
  },
  {
    title: t('settings.apiScopes.governedSchema'),
    description: t('settings.apiScopes.catalogueGetGatedDescription'),
    effective: false,
    scopes: ['schema:read', 'schema:write', 'schema:publish'],
  },
  {
    title: t('settings.apiScopes.sheets'),
    description: t('settings.apiScopes.sheetInstanceReadsDescription'),
    effective: true,
    scopes: ['sheets:read', 'sheets:write'],
  },
  {
    title: t('settings.apiScopes.models'),
    description: t('settings.apiScopes.modelRecordSearchDescription'),
    effective: true,
    scopes: ['models:read', 'models:write'],
  },
  {
    title: t('settings.apiScopes.templates'),
    description: t('settings.apiScopes.notebookTemplateCatalogueDescription'),
    effective: true,
    scopes: ['templates:read', 'templates:write'],
  },
  {
    title: t('settings.apiScopes.reviewsPreview'),
    description: t('settings.apiScopes.previewNotebookSubmissionDescription'),
    effective: true,
    scopes: ['reviews:read'],
  },
  {
    title: t('settings.apiScopes.reviewsAttestation'),
    description: t('settings.apiScopes.mintableNowSubmitDescription'),
    effective: false,
    scopes: ['reviews:write'],
  },
  {
    title: t('settings.apiScopes.files'),
    description: t('settings.apiScopes.mintableNowFileDescription'),
    effective: false,
    scopes: ['files:read', 'files:write'],
  },
  {
    title: t('settings.apiScopes.webhooks'),
    description: t(
      'settings.apiScopes.webhookSubscriptionManagementDescription',
    ),
    effective: true,
    scopes: ['webhooks:read', 'webhooks:write'],
  },
  {
    title: t('settings.apiScopes.agentOperations'),
    description: t('settings.apiScopes.submitInspectTypedDescription'),
    effective: true,
    scopes: ['agent_operations:read', 'agent_operations:write'],
  },
  {
    title: t('settings.apiScopes.pipelines'),
    description: t('settings.apiScopes.readPipelineDefinitionsDescription'),
    effective: true,
    scopes: ['pipelines:read', 'pipelines:write'],
  },
  {
    title: t('settings.apiScopes.administrationMcp'),
    description: t('settings.apiScopes.personalTokenScopesDescription'),
    effective: false,
    personalOnly: true,
    scopes: ['admin:read', 'admin:write'],
  },
]

/**
 * The scope groups a workspace service credential may hold. Administration is
 * personal-token only, so the service-credential form must not offer it.
 */
export const SERVICE_SCOPE_GROUPS = SCOPE_GROUPS.filter(
  (group) => !group.personalOnly,
)
