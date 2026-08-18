/**
 * External credential scope vocabulary (API-01 contract §8).
 *
 * `PRODUCT_SCOPES` may be issued by the admin UI and `createCredential`.
 * `scientific:*` remains valid on existing rows and at exchange, but new
 * credentials must not receive those scopes (API-02 / contract §9.2).
 *
 * Minting a Core-domain scope does not grant access until a later epic
 * expands `src/lib/external-token.ts`. Today only `projects:*` is effective.
 */

export const PRODUCT_SCOPES = [
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

export const SCIENTIFIC_SCOPES = [
  'scientific:read',
  'scientific:write',
  'scientific:schema',
] as const

export const VALID_SCOPES = [...PRODUCT_SCOPES, ...SCIENTIFIC_SCOPES] as const

export type ProductScope = (typeof PRODUCT_SCOPES)[number]
export type ScientificScope = (typeof SCIENTIFIC_SCOPES)[number]
export type Scope = (typeof VALID_SCOPES)[number]

export function isScientificScope(scope: string): scope is ScientificScope {
  return (SCIENTIFIC_SCOPES as readonly string[]).includes(scope)
}

export function isProductScope(scope: string): scope is ProductScope {
  return (PRODUCT_SCOPES as readonly string[]).includes(scope)
}

export function isValidScope(scope: string): scope is Scope {
  return (VALID_SCOPES as readonly string[]).includes(scope)
}

/** Admin UI grouping. `effective` means the current external allowlist honours it. */
export const SCOPE_GROUPS: ReadonlyArray<{
  title: string
  description: string
  effective: boolean
  scopes: readonly ProductScope[]
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
