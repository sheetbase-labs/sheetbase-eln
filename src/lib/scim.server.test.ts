import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

import { handleScimRequest } from './scim.server'
import type { ScimDeps, ScimPrincipal, ScimStore } from './scim.server'
import type { GroupDoc, UserDoc } from './scim'

const SECRET = 'sbscim_test'
const ID = '11111111-1111-4111-8111-111111111111'
const GID = '22222222-2222-4222-8222-222222222222'

const principal: ScimPrincipal = {
  tokenId: 't1',
  workspaceId: 'w1',
  actorUserId: 'u1',
}

const user: UserDoc = {
  id: ID,
  user_name: 'ada@lab.org',
  external_id: null,
  email: 'ada@lab.org',
  display_name: 'Ada Lovelace',
  active: true,
  role: 'viewer',
  created: '2026-11-06T00:00:00Z',
  updated: '2026-11-06T00:00:00Z',
  groups: [],
}

const group: GroupDoc = {
  id: GID,
  display_name: 'Admins',
  external_id: null,
  created: '2026-11-06T00:00:00Z',
  updated: '2026-11-06T00:00:00Z',
  members: [{ value: ID, display: 'ada@lab.org' }],
}

function store(overrides: Partial<ScimStore> = {}): ScimStore {
  return {
    authenticate: vi.fn(async (hash: string) =>
      hash === createHash('sha256').update(SECRET).digest('hex')
        ? principal
        : null,
    ),
    listUsers: vi.fn(async () => ({ total: 1, rows: [user] })),
    getUser: vi.fn(async (_p, id) => (id === ID ? user : null)),
    createUser: vi.fn(async () => user),
    updateUser: vi.fn(async () => user),
    deleteUser: vi.fn(async () => undefined),
    listGroups: vi.fn(async () => ({ total: 1, rows: [group] })),
    getGroup: vi.fn(async (_p, id) => (id === GID ? group : null)),
    setGroup: vi.fn(async () => group),
    deleteGroup: vi.fn(async () => undefined),
    ...overrides,
  }
}

function call(
  deps: ScimDeps,
  method: string,
  path: string,
  options: { body?: unknown; token?: string | null; query?: string } = {},
) {
  const headers = new Headers({ 'content-type': 'application/scim+json' })

  if (options.token !== null) {
    headers.set('authorization', `Bearer ${options.token ?? SECRET}`)
  }

  return handleScimRequest(
    new Request(`https://eln.test/api/scim/v2/${path}${options.query ?? ''}`, {
      method,
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    path,
    deps,
  )
}

const deps = (s: ScimStore): ScimDeps => ({
  store: s,
  baseUrl: 'https://eln.test',
})

describe('the SCIM endpoint', () => {
  it('asks for a token, and refuses one that is wrong', async () => {
    const s = store()
    const none = await call(deps(s), 'GET', 'Users', { token: null })
    expect(none.status).toBe(401)
    expect(none.headers.get('www-authenticate')).toContain('Bearer')
    const wrong = await call(deps(s), 'GET', 'Users', { token: 'nope' })
    expect(wrong.status).toBe(401)
    expect(s.listUsers).not.toHaveBeenCalled()
    expect((await wrong.json()).schemas[0]).toContain('Error')
  })

  it('describes itself', async () => {
    const s = store()

    const config = await (
      await call(deps(s), 'GET', 'ServiceProviderConfig')
    ).json()

    expect(config.patch.supported).toBe(true)
    const types = await (await call(deps(s), 'GET', 'ResourceTypes')).json()
    expect(types.totalResults).toBe(2)
    expect((await call(deps(s), 'GET', 'Schemas')).status).toBe(200)
    expect((await call(deps(s), 'GET', 'Nope')).status).toBe(404)
  })

  it('lists and looks people up by userName', async () => {
    const s = store()

    const res = await call(deps(s), 'GET', 'Users', {
      query: '?filter=userName%20eq%20%22ada%40lab.org%22&count=10',
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('scim+json')
    const body = await res.json()
    expect(body.totalResults).toBe(1)
    expect(body.Resources[0].userName).toBe('ada@lab.org')
    expect(s.listUsers).toHaveBeenCalledWith(
      principal,
      { userName: 'ada@lab.org', externalId: undefined },
      1,
      10,
    )
  })

  it('creates a user and answers 201 with a Location', async () => {
    const s = store()

    const res = await call(deps(s), 'POST', 'Users', {
      body: { userName: 'ada@lab.org', active: true },
    })

    expect(res.status).toBe(201)
    expect(res.headers.get('location')).toBe(
      `https://eln.test/api/scim/v2/Users/${ID}`,
    )
    expect(s.createUser).toHaveBeenCalledWith(principal, {
      userName: 'ada@lab.org',
      active: true,
    })
  })

  it('switches a person off with a PATCH', async () => {
    const s = store()

    const res = await call(deps(s), 'PATCH', `Users/${ID}`, {
      body: { Operations: [{ op: 'Replace', path: 'active', value: 'False' }] },
    })

    expect(res.status).toBe(200)
    expect(s.updateUser).toHaveBeenCalledWith(principal, ID, { active: false })
  })

  it('answers 404 for an unknown user and for an id that is not one', async () => {
    const s = store()
    expect((await call(deps(s), 'GET', `Users/${GID}`)).status).toBe(404)
    expect((await call(deps(s), 'GET', 'Users/not-an-id')).status).toBe(404)
  })

  it('answers 204 to a delete', async () => {
    const s = store()
    const res = await call(deps(s), 'DELETE', `Users/${ID}`)
    expect(res.status).toBe(204)
    expect(s.deleteUser).toHaveBeenCalledWith(principal, ID)
  })

  it('answers with the SCIM error the store raises', async () => {
    const { ScimError } = await import('./scim')

    const s = store({
      createUser: vi.fn(async () => {
        throw new ScimError(
          409,
          'uniqueness',
          'a user with this userName already exists',
        )
      }),
    })

    const res = await call(deps(s), 'POST', 'Users', {
      body: { userName: 'a@b.co' },
    })

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      status: '409',
      scimType: 'uniqueness',
    })
  })

  it('does not leak an unexpected failure', async () => {
    const s = store({
      listUsers: vi.fn(async () => {
        throw new Error('connection refused at 10.0.0.5')
      }),
    })

    const res = await call(deps(s), 'GET', 'Users')
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('10.0.0.5')
  })

  it('rejects unreadable JSON', async () => {
    const s = store()

    const res = await handleScimRequest(
      new Request('https://eln.test/api/scim/v2/Users', {
        method: 'POST',
        headers: { authorization: `Bearer ${SECRET}` },
        body: '{nope',
      }),
      'Users',
      deps(s),
    )

    expect(res.status).toBe(400)
  })

  it('patches group members from what the group has now', async () => {
    const s = store()

    const res = await call(deps(s), 'PATCH', `Groups/${GID}`, {
      body: {
        Operations: [
          { op: 'add', path: 'members', value: [{ value: GID }] },
          { op: 'remove', path: `members[value eq "${ID}"]` },
        ],
      },
    })

    expect(res.status).toBe(200)
    expect(s.setGroup).toHaveBeenCalledWith(principal, GID, { members: [GID] })
  })

  it('creates, replaces and deletes groups', async () => {
    const s = store()
    expect(
      (
        await call(deps(s), 'POST', 'Groups', {
          body: { displayName: 'Admins' },
        })
      ).status,
    ).toBe(201)
    expect(
      (
        await call(deps(s), 'PUT', `Groups/${GID}`, {
          body: { displayName: 'Admins' },
        })
      ).status,
    ).toBe(200)
    expect(s.setGroup).toHaveBeenLastCalledWith(principal, GID, {
      displayName: 'Admins',
      members: [],
    })
    expect((await call(deps(s), 'DELETE', `Groups/${GID}`)).status).toBe(204)
  })

  it('refuses a method the resource does not take', async () => {
    const s = store()
    expect((await call(deps(s), 'DELETE', 'Users')).status).toBe(405)
    expect((await call(deps(s), 'POST', 'ServiceProviderConfig')).status).toBe(
      405,
    )
  })
})
