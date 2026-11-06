/**
 * SCIM 2.0 (RFC 7643 and 7644) for users and groups: the parts that do not
 * need a database. Parsing filters and patch requests, and shaping what the
 * endpoint sends back, live here so they can be tested on their own;
 * `scim.server.ts` carries the requests to the database.
 *
 * Identity providers differ in small ways (Okta sends `{"value": {...}}` with
 * no path; Entra ID sends `"Replace"` capitalised and booleans as the strings
 * `"True"` and `"False"`), so patch handling accepts both.
 */

export const SCIM_SCHEMAS = {
  user: 'urn:ietf:params:scim:schemas:core:2.0:User',
  group: 'urn:ietf:params:scim:schemas:core:2.0:Group',
  list: 'urn:ietf:params:scim:api:messages:2.0:ListResponse',
  error: 'urn:ietf:params:scim:api:messages:2.0:Error',
  patch: 'urn:ietf:params:scim:api:messages:2.0:PatchOp',
  config: 'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig',
  resourceType: 'urn:ietf:params:scim:schemas:core:2.0:ResourceType',
  schema: 'urn:ietf:params:scim:schemas:core:2.0:Schema',
} as const

export const SCIM_CONTENT_TYPE = 'application/scim+json'

/** The most one page may hold. */
export const SCIM_MAX_PAGE = 100

export class ScimError extends Error {
  constructor(
    readonly status: number,
    readonly scimType: string | null,
    detail: string,
  ) {
    super(detail)
  }
}

export interface UserDoc {
  id: string
  user_name: string
  external_id: string | null
  email: string
  display_name: string
  active: boolean
  role: string
  created: string
  updated: string
  groups: { value: string; display: string }[]
}

export interface GroupDoc {
  id: string
  display_name: string
  external_id: string | null
  created: string
  updated: string
  members: { value: string; display: string }[]
}

export interface Page<T> {
  total: number
  rows: T[]
}

// -- Filters -----------------------------------------------------------------

export interface Eq {
  attribute: string
  value: string
}

/**
 * Identity providers look people up with one equality, e.g.
 * `userName eq "ada@lab.org"`. That is all the endpoint answers; it says so
 * rather than quietly returning everyone for a filter it cannot read.
 */
export function parseFilter(
  raw: string | null,
  allowed: readonly string[],
): Eq | null {
  if (raw === null || raw.trim() === '') return null
  const match = /^\s*([A-Za-z][\w.]*)\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$/i.exec(raw)
  if (!match) {
    throw new ScimError(
      400,
      'invalidFilter',
      'Only a single `attribute eq "value"` filter is supported.',
    )
  }
  const attribute = allowed.find(
    (name) => name.toLowerCase() === match[1].toLowerCase(),
  )
  if (!attribute) {
    throw new ScimError(
      400,
      'invalidFilter',
      `Filter on one of: ${allowed.join(', ')}.`,
    )
  }
  return { attribute, value: match[2].replace(/\\(.)/g, '$1') }
}

export function parsePaging(query: URLSearchParams): {
  start: number
  count: number
} {
  const number = (name: string, fallback: number) => {
    const raw = query.get(name)
    if (raw === null || raw === '') return fallback
    const parsed = Number(raw)
    if (!Number.isInteger(parsed)) {
      throw new ScimError(400, 'invalidValue', `${name} must be a whole number.`)
    }
    return parsed
  }
  return {
    start: Math.max(1, number('startIndex', 1)),
    count: Math.min(SCIM_MAX_PAGE, Math.max(0, number('count', SCIM_MAX_PAGE))),
  }
}

// -- Reading what the provider sent ------------------------------------------

export interface UserChanges {
  userName?: string
  externalId?: string | null
  displayName?: string
  email?: string
  active?: boolean
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** Entra ID sends booleans as "True" and "False". */
export function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase()
    if (lowered === 'true') return true
    if (lowered === 'false') return false
  }
  return undefined
}

function pickEmail(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  const emails = value.filter(isObject)
  const primary = emails.find((e) => toBoolean(e.primary) === true) ?? emails[0]
  return typeof primary?.value === 'string' ? primary.value : undefined
}

function nameOf(value: Record<string, unknown>): string | undefined {
  if (typeof value.displayName === 'string' && value.displayName.trim()) {
    return value.displayName
  }
  const name = value.name
  if (isObject(name)) {
    if (typeof name.formatted === 'string' && name.formatted.trim()) {
      return name.formatted
    }
    const joined = [name.givenName, name.familyName]
      .filter((part): part is string => typeof part === 'string')
      .join(' ')
      .trim()
    if (joined) return joined
  }
  return undefined
}

/** A user as the provider sent it, whole (POST and PUT). */
export function readUser(body: unknown): UserChanges {
  if (!isObject(body)) {
    throw new ScimError(400, 'invalidSyntax', 'Send a User as a JSON object.')
  }
  const changes: UserChanges = {}
  if (typeof body.userName === 'string') changes.userName = body.userName
  if (body.externalId !== undefined) {
    changes.externalId =
      typeof body.externalId === 'string' ? body.externalId : null
  }
  const display = nameOf(body)
  if (display) changes.displayName = display
  const email = pickEmail(body.emails)
  if (email) changes.email = email
  const active = toBoolean(body.active)
  if (active !== undefined) changes.active = active
  return changes
}

interface PatchOperation {
  op: 'add' | 'replace' | 'remove'
  path?: string
  value?: unknown
}

export function readPatch(body: unknown): PatchOperation[] {
  if (!isObject(body) || !Array.isArray(body.Operations)) {
    throw new ScimError(
      400,
      'invalidSyntax',
      'A PATCH needs an Operations list.',
    )
  }
  return body.Operations.map((raw) => {
    if (!isObject(raw) || typeof raw.op !== 'string') {
      throw new ScimError(400, 'invalidSyntax', 'Each operation needs an op.')
    }
    const op = raw.op.toLowerCase()
    if (op !== 'add' && op !== 'replace' && op !== 'remove') {
      throw new ScimError(400, 'invalidSyntax', `Unknown operation ${raw.op}.`)
    }
    return {
      op,
      path: typeof raw.path === 'string' ? raw.path : undefined,
      value: raw.value,
    }
  })
}

/**
 * Turn user patch operations into the changes to make. Attributes Sheetbase
 * does not keep (phone numbers, titles, enterprise extension) are accepted
 * and ignored, as the standard asks of a server that does not store them.
 */
export function userChangesFromPatch(body: unknown): UserChanges {
  const changes: UserChanges = {}
  for (const operation of readPatch(body)) {
    const path = operation.path?.trim()
    if (!path) {
      if (operation.op === 'remove') {
        throw new ScimError(400, 'noTarget', 'A remove needs a path.')
      }
      Object.assign(changes, readUser(operation.value))
      continue
    }
    const key = path.replace(/^urn:[^:]+(:[^:]+)*:/, '').toLowerCase()
    const value = operation.value
    switch (true) {
      case key === 'active': {
        changes.active =
          operation.op === 'remove' ? false : (toBoolean(value) ?? undefined)
        if (changes.active === undefined) {
          throw new ScimError(400, 'invalidValue', 'active must be true or false.')
        }
        break
      }
      case key === 'username':
        if (operation.op !== 'remove' && typeof value === 'string') {
          changes.userName = value
        }
        break
      case key === 'externalid':
        changes.externalId =
          operation.op === 'remove' || typeof value !== 'string' ? null : value
        break
      case key === 'displayname':
      case key === 'name.formatted':
        if (operation.op !== 'remove' && typeof value === 'string') {
          changes.displayName = value
        }
        break
      case key === 'name':
        if (isObject(value)) {
          const display = nameOf({ name: value })
          if (display) changes.displayName = display
        }
        break
      case key.startsWith('emails'):
        if (operation.op !== 'remove') {
          const email =
            typeof value === 'string' ? value : pickEmail(value)
          if (email) changes.email = email
        }
        break
      default:
        break
    }
  }
  return changes
}

export interface GroupChanges {
  displayName?: string
  externalId?: string | null
  members?: string[]
}

function memberIds(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value]
  return list.map((entry) => {
    const id = isObject(entry) ? entry.value : entry
    if (typeof id !== 'string' || id === '') {
      throw new ScimError(400, 'invalidValue', 'A member needs a value (its id).')
    }
    return id
  })
}

/** A group as the provider sent it, whole (POST and PUT). */
export function readGroup(body: unknown): GroupChanges {
  if (!isObject(body)) {
    throw new ScimError(400, 'invalidSyntax', 'Send a Group as a JSON object.')
  }
  const changes: GroupChanges = {}
  if (typeof body.displayName === 'string') changes.displayName = body.displayName
  if (body.externalId !== undefined) {
    changes.externalId =
      typeof body.externalId === 'string' ? body.externalId : null
  }
  if (body.members !== undefined) changes.members = memberIds(body.members)
  return changes
}

/**
 * Apply group patch operations to the members as they stand and return the
 * full list the group should have afterwards.
 */
export function groupChangesFromPatch(
  body: unknown,
  currentMembers: string[],
): GroupChanges {
  const changes: GroupChanges = {}
  let members = [...currentMembers]
  let touched = false
  for (const operation of readPatch(body)) {
    const path = operation.path?.trim()
    if (!path) {
      if (operation.op === 'remove') {
        throw new ScimError(400, 'noTarget', 'A remove needs a path.')
      }
      const whole = readGroup(operation.value)
      if (whole.displayName !== undefined) changes.displayName = whole.displayName
      if (whole.externalId !== undefined) changes.externalId = whole.externalId
      if (whole.members) {
        members =
          operation.op === 'add'
            ? [...new Set([...members, ...whole.members])]
            : whole.members
        touched = true
      }
      continue
    }
    const lowered = path.toLowerCase()
    if (lowered === 'displayname') {
      if (typeof operation.value === 'string') changes.displayName = operation.value
      continue
    }
    if (lowered === 'externalid') {
      changes.externalId =
        operation.op === 'remove' || typeof operation.value !== 'string'
          ? null
          : operation.value
      continue
    }
    if (lowered === 'members' || lowered.startsWith('members[')) {
      touched = true
      const filtered = /^members\[\s*value\s+eq\s+"([^"]+)"\s*\]$/i.exec(path)
      if (operation.op === 'remove') {
        const gone = filtered
          ? [filtered[1]]
          : operation.value === undefined
            ? members
            : memberIds(operation.value)
        members = members.filter((id) => !gone.includes(id))
      } else if (operation.op === 'add') {
        members = [...new Set([...members, ...memberIds(operation.value)])]
      } else {
        members = memberIds(operation.value)
      }
    }
  }
  if (touched) changes.members = members
  return changes
}

// -- What goes back ----------------------------------------------------------

export function toScimUser(doc: UserDoc, base: string) {
  const [given, ...rest] = doc.display_name.split(' ')
  return {
    schemas: [SCIM_SCHEMAS.user],
    id: doc.id,
    externalId: doc.external_id ?? undefined,
    userName: doc.user_name,
    name: {
      formatted: doc.display_name,
      givenName: given,
      familyName: rest.join(' ') || undefined,
    },
    displayName: doc.display_name,
    emails: [{ value: doc.email, type: 'work', primary: true }],
    active: doc.active,
    groups: doc.groups.map((group) => ({
      value: group.value,
      display: group.display,
      $ref: `${base}/Groups/${group.value}`,
    })),
    meta: {
      resourceType: 'User',
      created: doc.created,
      lastModified: doc.updated,
      location: `${base}/Users/${doc.id}`,
    },
  }
}

export function toScimGroup(doc: GroupDoc, base: string) {
  return {
    schemas: [SCIM_SCHEMAS.group],
    id: doc.id,
    externalId: doc.external_id ?? undefined,
    displayName: doc.display_name,
    members: doc.members.map((member) => ({
      value: member.value,
      display: member.display,
      $ref: `${base}/Users/${member.value}`,
    })),
    meta: {
      resourceType: 'Group',
      created: doc.created,
      lastModified: doc.updated,
      location: `${base}/Groups/${doc.id}`,
    },
  }
}

export function listResponse<T>(
  resources: T[],
  total: number,
  startIndex: number,
) {
  return {
    schemas: [SCIM_SCHEMAS.list],
    totalResults: total,
    startIndex,
    itemsPerPage: resources.length,
    Resources: resources,
  }
}

export function errorBody(error: ScimError) {
  return {
    schemas: [SCIM_SCHEMAS.error],
    status: String(error.status),
    ...(error.scimType ? { scimType: error.scimType } : {}),
    detail: error.message,
  }
}

export function serviceProviderConfig(base: string) {
  return {
    schemas: [SCIM_SCHEMAS.config],
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: SCIM_MAX_PAGE },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: 'oauthbearertoken',
        name: 'Bearer token',
        description:
          'A token made in Settings, under Members and roles, sent as Authorization: Bearer.',
        specUri: 'https://www.rfc-editor.org/info/rfc6750',
        primary: true,
      },
    ],
    meta: {
      resourceType: 'ServiceProviderConfig',
      location: `${base}/ServiceProviderConfig`,
    },
  }
}

export function resourceTypes(base: string) {
  return [
    {
      schemas: [SCIM_SCHEMAS.resourceType],
      id: 'User',
      name: 'User',
      endpoint: '/Users',
      schema: SCIM_SCHEMAS.user,
      meta: { resourceType: 'ResourceType', location: `${base}/ResourceTypes/User` },
    },
    {
      schemas: [SCIM_SCHEMAS.resourceType],
      id: 'Group',
      name: 'Group',
      endpoint: '/Groups',
      schema: SCIM_SCHEMAS.group,
      meta: { resourceType: 'ResourceType', location: `${base}/ResourceTypes/Group` },
    },
  ]
}

const attribute = (
  name: string,
  type: string,
  extra: Record<string, unknown> = {},
) => ({
  name,
  type,
  multiValued: false,
  required: false,
  caseExact: false,
  mutability: 'readWrite',
  returned: 'default',
  uniqueness: 'none',
  ...extra,
})

export function schemas(base: string) {
  return [
    {
      id: SCIM_SCHEMAS.user,
      name: 'User',
      description: 'A person who can sign in to the workspace.',
      attributes: [
        attribute('userName', 'string', { required: true, uniqueness: 'server' }),
        attribute('externalId', 'string', { caseExact: true }),
        attribute('displayName', 'string'),
        attribute('active', 'boolean'),
        attribute('emails', 'complex', {
          multiValued: true,
          subAttributes: [
            attribute('value', 'string'),
            attribute('type', 'string'),
            attribute('primary', 'boolean'),
          ],
        }),
        attribute('groups', 'complex', {
          multiValued: true,
          mutability: 'readOnly',
        }),
      ],
      meta: { resourceType: 'Schema', location: `${base}/Schemas/${SCIM_SCHEMAS.user}` },
    },
    {
      id: SCIM_SCHEMAS.group,
      name: 'Group',
      description:
        'A group in the identity provider. Its name is matched to the sign-in group mappings to decide roles.',
      attributes: [
        attribute('displayName', 'string', { required: true, uniqueness: 'server' }),
        attribute('externalId', 'string', { caseExact: true }),
        attribute('members', 'complex', { multiValued: true }),
      ],
      meta: { resourceType: 'Schema', location: `${base}/Schemas/${SCIM_SCHEMAS.group}` },
    },
  ]
}
