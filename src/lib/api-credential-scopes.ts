/**
 * External credential scope vocabulary (API-01 contract §8).
 *
 * This is the only issuable vocabulary. `scientific:*` is removed, not
 * deprecated. Minting a Core-domain scope does not grant access until a
 * later epic expands `src/lib/external-token.ts`. Today only `projects:*`
 * is enforced on the external allowlist.
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
      'Mintable now. Dataset and row RPCs remain fail-closed until a later allowlist epic.',
    effective: false,
    scopes: ['datasets:read', 'datasets:write'],
  },
  {
    title: 'Governed schema',
    description:
      'Catalogue authority, distinct from Dataset data. Fail-closed until allowlist cut-over.',
    effective: false,
    scopes: ['schema:read', 'schema:write', 'schema:publish'],
  },
  {
    title: 'Sheets',
    description:
      '`sheets:write` does not author Sheet Definitions. Fail-closed until allowlist cut-over.',
    effective: false,
    scopes: ['sheets:read', 'sheets:write'],
  },
  {
    title: 'Models',
    description:
      'Mintable now. Model RPCs remain fail-closed until allowlist cut-over.',
    effective: false,
    scopes: ['models:read', 'models:write'],
  },
  {
    title: 'Templates',
    description:
      'Mintable now. Notebook template RPCs remain fail-closed until allowlist cut-over.',
    effective: false,
    scopes: ['templates:read', 'templates:write'],
  },
  {
    title: 'Reviews',
    description:
      'Mintable now. Review RPCs remain fail-closed until allowlist cut-over.',
    effective: false,
    scopes: ['reviews:read', 'reviews:write'],
  },
  {
    title: 'Files',
    description:
      'Mintable now. File access remains fail-closed until a later epic.',
    effective: false,
    scopes: ['files:read', 'files:write'],
  },
]
