/**
 * External credential scope vocabulary (API-01 contract §8).
 *
 * This is the only issuable vocabulary. `scientific:*` is removed, not
 * deprecated. API-07 enforces Core Dataset/Sheet/Notebook scopes on the
 * external allowlist. File scopes and schema-authoring RPCs stay fail-closed.
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
    title: 'Reviews',
    description:
      'Submission preview and Notebook submit. Signing stays a session-actor path.',
    effective: true,
    scopes: ['reviews:read', 'reviews:write'],
  },
  {
    title: 'Files',
    description:
      'Mintable now. File access remains fail-closed until DATA-02 / PLAT-01.',
    effective: false,
    scopes: ['files:read', 'files:write'],
  },
]
