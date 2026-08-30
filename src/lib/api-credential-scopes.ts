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
  scopes: readonly Scope[]
}> = [
  {
    title: 'Projects',
    description:
      'Currently enforced on the external allowlist (project-domain tables and RPCs).',
    effective: true,
    scopes: ['projects:read', 'projects:write'],
  },
  {
    title: 'Datasets (data)',
    description:
      'Query, commit, snapshot and archive Datasets. Does not author Dataset Schema Versions.',
    effective: true,
    scopes: ['datasets:read', 'datasets:write'],
  },
  {
    title: 'Governed schema',
    description:
      'Catalogue GET is gated by schema:read. Authoring Dataset Schema Versions and Sheet Definitions stays denied.',
    effective: false,
    scopes: ['schema:read', 'schema:write', 'schema:publish'],
  },
  {
    title: 'Sheets',
    description:
      'Sheet Instance reads and mutations. `sheets:write` does not author Sheet Definitions.',
    effective: true,
    scopes: ['sheets:read', 'sheets:write'],
  },
  {
    title: 'Models',
    description:
      'Model record search and custom-field writes. Field-definition stewardship stays denied.',
    effective: true,
    scopes: ['models:read', 'models:write'],
  },
  {
    title: 'Templates',
    description:
      'Notebook template catalogue reads and instantiation. Template authoring RPCs stay denied.',
    effective: true,
    scopes: ['templates:read', 'templates:write'],
  },
  {
    title: 'Reviews (preview)',
    description:
      'Preview a Notebook submission digest. Does not submit, sign, amend or run revision checks.',
    effective: true,
    scopes: ['reviews:read'],
  },
  {
    title: 'Reviews (attestation)',
    description:
      'Mintable now. Submit, sign, amend and revision checks remain human-session-only.',
    effective: false,
    scopes: ['reviews:write'],
  },
  {
    title: 'Files',
    description:
      'Mintable now. File access remains fail-closed until DATA-02 / PLAT-01.',
    effective: false,
    scopes: ['files:read', 'files:write'],
  },
  {
    title: 'Webhooks',
    description:
      'Webhook subscription management and delivery history. Requires integrations.manage capability.',
    effective: true,
    scopes: ['webhooks:read', 'webhooks:write'],
  },
  {
    title: 'Agent operations',
    description:
      'Submit and inspect typed proposals and bounded workflows. Safe drafts and delegated create/append writes may execute automatically; other writes, approval, execution, and workflow resume require a human session.',
    effective: true,
    scopes: ['agent_operations:read', 'agent_operations:write'],
  },
]
