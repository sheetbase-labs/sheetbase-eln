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

import { z } from 'zod'

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

/** The first row a page starts at, and how many rows it may hold. */
export interface ScimPaging {
  start: number
  count: number
}

export function parsePaging(query: URLSearchParams): ScimPaging {
  const number = (name: string, fallback: number) => {
    const raw = query.get(name)

    if (raw === null || raw === '') return fallback
    const parsed = Number(raw)

    if (!Number.isInteger(parsed)) {
      throw new ScimError(
        400,
        'invalidValue',
        `${name} must be a whole number.`,
      )
    }

    return parsed
  }

  return {
    start: Math.max(1, number('startIndex', 1)),
    count: Math.min(SCIM_MAX_PAGE, Math.max(0, number('count', SCIM_MAX_PAGE))),
  }
}

// -- Reading what the provider sent ------------------------------------------

/** A SCIM request body as the HTTP layer hands it over: JSON, not yet shaped. */
type ScimJson = z.core.util.JSONType

/** A JSON object's entries; every value keeps its JSON type until decoded. */
const objectSchema = z.record(z.string(), z.json())

type ScimObject = z.infer<typeof objectSchema>

const textSchema = z.string()

function asObject(value: ScimJson | undefined): ScimObject | null {
  const object = objectSchema.safeParse(value)

  return object.success ? object.data : null
}

function asText(value: ScimJson | undefined): string | undefined {
  const text = textSchema.safeParse(value)

  return text.success ? text.data : undefined
}

/** Text that is not only space, exactly as the provider sent it. */
function asNamedText(value: ScimJson | undefined): string | undefined {
  const text = asText(value)

  return text !== undefined && text.trim() !== '' ? text : undefined
}

export interface UserChanges {
  userName?: string
  externalId?: string | null
  displayName?: string
  email?: string
  active?: boolean
}

/** Entra ID sends booleans as "True" and "False". */
export function toBoolean(value: ScimJson | undefined): boolean | undefined {
  const flag = z.boolean().safeParse(value)

  if (flag.success) return flag.data
  const text = asText(value)

  if (text === undefined) return undefined
  const lowered = text.trim().toLowerCase()

  if (lowered === 'true') return true

  if (lowered === 'false') return false

  return undefined
}

function pickEmail(value: ScimJson | undefined): string | undefined {
  const list = z.array(z.json()).safeParse(value)

  if (!list.success) return undefined

  const emails = list.data.flatMap((entry) => {
    const email = asObject(entry)

    return email === null ? [] : [email]
  })

  const primary =
    emails.find((e) => toBoolean(e.primary) === true) ?? emails.at(0)

  return asText(primary?.value)
}

/** The `externalId` a provider sent, and null for a value it did not send as text. */
function readExternalId(object: ScimObject): string | null | undefined {
  if (!Object.hasOwn(object, 'externalId')) return undefined

  return asText(object.externalId) ?? null
}

function nameOf(value: ScimObject): string | undefined {
  const displayName = asNamedText(value.displayName)

  if (displayName !== undefined) {
    return displayName
  }

  const name = asObject(value.name)

  if (name !== null) {
    const formatted = asNamedText(name.formatted)

    if (formatted !== undefined) {
      return formatted
    }

    const joined = [name.givenName, name.familyName]
      .flatMap((part) => asNamedText(part) ?? [])
      .join(' ')
      .trim()

    if (joined) return joined
  }

  return undefined
}

/** A user as the provider sent it, whole (POST and PUT). */
export function readUser(body: ScimJson): UserChanges {
  const user = asObject(body)

  if (user === null) {
    throw new ScimError(400, 'invalidSyntax', 'Send a User as a JSON object.')
  }

  const changes: UserChanges = {}

  const userName = asText(user.userName)

  if (userName !== undefined) changes.userName = userName

  const externalId = readExternalId(user)

  if (externalId !== undefined) changes.externalId = externalId

  const display = nameOf(user)

  if (display) changes.displayName = display
  const email = pickEmail(user.emails)

  if (email) changes.email = email
  const active = toBoolean(user.active)

  if (active !== undefined) changes.active = active

  return changes
}

export interface PatchOperation {
  op: 'add' | 'replace' | 'remove'
  path?: string
  value?: ScimJson
}

export function readPatch(body: ScimJson): PatchOperation[] {
  const root = asObject(body)

  const operations =
    root === null ? null : z.array(z.json()).safeParse(root.Operations)

  if (operations === null || !operations.success) {
    throw new ScimError(
      400,
      'invalidSyntax',
      'A PATCH needs an Operations list.',
    )
  }

  return operations.data.map((raw) => {
    const operation = asObject(raw)
    const written = operation === null ? undefined : asText(operation.op)

    if (written === undefined) {
      throw new ScimError(400, 'invalidSyntax', 'Each operation needs an op.')
    }

    const op = written.toLowerCase()

    if (op !== 'add' && op !== 'replace' && op !== 'remove') {
      throw new ScimError(400, 'invalidSyntax', `Unknown operation ${written}.`)
    }

    return {
      op,
      path: operation === null ? undefined : asText(operation.path),
      value: operation?.value,
    }
  })
}

/**
 * Turn user patch operations into the changes to make. Attributes Sheetbase
 * does not keep (phone numbers, titles, enterprise extension) are accepted
 * and ignored, as the standard asks of a server that does not store them.
 */
export function userChangesFromPatch(body: ScimJson): UserChanges {
  const changes: UserChanges = {}

  for (const operation of readPatch(body)) {
    const path = operation.path?.trim()

    if (!path) {
      if (operation.op === 'remove') {
        throw new ScimError(400, 'noTarget', 'A remove needs a path.')
      }

      Object.assign(changes, readUser(operation.value ?? null))
      continue
    }

    const key = path.replace(/^urn:[^:]+(:[^:]+)*:/, '').toLowerCase()
    const value = operation.value

    switch (true) {
      case key === 'active': {
        changes.active = operation.op === 'remove' ? false : toBoolean(value)

        if (changes.active === undefined) {
          throw new ScimError(
            400,
            'invalidValue',
            'active must be true or false.',
          )
        }

        break
      }

      case key === 'username': {
        const userName = asText(value)

        if (operation.op !== 'remove' && userName !== undefined) {
          changes.userName = userName
        }

        break
      }

      case key === 'externalid':
        changes.externalId =
          operation.op === 'remove' ? null : (asText(value) ?? null)
        break
      case key === 'displayname':
      case key === 'name.formatted': {
        const displayName = asText(value)

        if (operation.op !== 'remove' && displayName !== undefined) {
          changes.displayName = displayName
        }

        break
      }

      case key === 'name': {
        const name = asObject(value)

        if (name !== null) {
          const display = nameOf({ name })

          if (display) changes.displayName = display
        }

        break
      }

      case key.startsWith('emails'):
        if (operation.op !== 'remove') {
          const email = asText(value) ?? pickEmail(value)

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

function memberIds(value: ScimJson | undefined): string[] {
  const list = value === undefined ? [] : Array.isArray(value) ? value : [value]

  return list.map((entry) => {
    const member = asObject(entry)
    const id = asText(member === null ? entry : member.value)

    if (id === undefined || id === '') {
      throw new ScimError(
        400,
        'invalidValue',
        'A member needs a value (its id).',
      )
    }

    return id
  })
}

/** A group as the provider sent it, whole (POST and PUT). */
export function readGroup(body: ScimJson): GroupChanges {
  const group = asObject(body)

  if (group === null) {
    throw new ScimError(400, 'invalidSyntax', 'Send a Group as a JSON object.')
  }

  const changes: GroupChanges = {}

  const displayName = asText(group.displayName)

  if (displayName !== undefined) changes.displayName = displayName

  const externalId = readExternalId(group)

  if (externalId !== undefined) changes.externalId = externalId

  if (Object.hasOwn(group, 'members')) {
    changes.members = memberIds(group.members)
  }

  return changes
}

/**
 * Apply group patch operations to the members as they stand and return the
 * full list the group should have afterwards.
 */
export function groupChangesFromPatch(
  body: ScimJson,
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

      const whole = readGroup(operation.value ?? null)

      if (whole.displayName !== undefined)
        changes.displayName = whole.displayName

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
      const displayName = asText(operation.value)

      if (displayName !== undefined) changes.displayName = displayName
      continue
    }

    if (lowered === 'externalid') {
      changes.externalId =
        operation.op === 'remove' ? null : (asText(operation.value) ?? null)
      continue
    }

    if (lowered === 'members' || lowered.startsWith('members[')) {
      touched = true
      const filtered = /^members\[\s*value\s+eq\s+"([^"]+)"\s*\]$/i.exec(path)

      if (operation.op === 'remove') {
        const named = filtered?.at(1)

        const gone =
          named === undefined
            ? operation.value === undefined
              ? members
              : memberIds(operation.value)
            : [named]

        const removed = new Set(gone)

        members = members.filter((id) => !removed.has(id))
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
  const body = {
    schemas: [SCIM_SCHEMAS.error],
    status: String(error.status),
    detail: error.message,
  }

  return error.scimType ? { ...body, scimType: error.scimType } : body
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
      meta: {
        resourceType: 'ResourceType',
        location: `${base}/ResourceTypes/User`,
      },
    },
    {
      schemas: [SCIM_SCHEMAS.resourceType],
      id: 'Group',
      name: 'Group',
      endpoint: '/Groups',
      schema: SCIM_SCHEMAS.group,
      meta: {
        resourceType: 'ResourceType',
        location: `${base}/ResourceTypes/Group`,
      },
    },
  ]
}

/** One attribute description in a SCIM schema document. */
interface ScimAttribute {
  name: string
  type: string
  multiValued: boolean
  required: boolean
  caseExact: boolean
  mutability: string
  returned: string
  uniqueness: string
  subAttributes?: ScimAttribute[]
}

/** The defaults an attribute description may override. */
type ScimAttributeFacts = Omit<ScimAttribute, 'name' | 'type'>

const attribute = (
  name: string,
  type: string,
  extra: Partial<ScimAttributeFacts> = {},
): ScimAttribute => ({
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
        attribute('userName', 'string', {
          required: true,
          uniqueness: 'server',
        }),
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
      meta: {
        resourceType: 'Schema',
        location: `${base}/Schemas/${SCIM_SCHEMAS.user}`,
      },
    },
    {
      id: SCIM_SCHEMAS.group,
      name: 'Group',
      description:
        'A group in the identity provider. Its name is matched to the sign-in group mappings to decide roles.',
      attributes: [
        attribute('displayName', 'string', {
          required: true,
          uniqueness: 'server',
        }),
        attribute('externalId', 'string', { caseExact: true }),
        attribute('members', 'complex', { multiValued: true }),
      ],
      meta: {
        resourceType: 'Schema',
        location: `${base}/Schemas/${SCIM_SCHEMAS.group}`,
      },
    },
  ]
}
