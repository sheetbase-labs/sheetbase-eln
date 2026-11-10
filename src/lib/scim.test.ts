import { describe, expect, it } from 'vitest'

import {
  ScimError,
  groupChangesFromPatch,
  parseFilter,
  parsePaging,
  readGroup,
  readUser,
  toScimUser,
  userChangesFromPatch,
} from './scim'

describe('filters', () => {
  it('reads one equality, whatever the case of the attribute', () => {
    expect(parseFilter('userName eq "Ada@Lab.org"', ['userName'])).toEqual({
      attribute: 'userName',
      value: 'Ada@Lab.org',
    })
    expect(parseFilter('USERNAME EQ "x"', ['userName'])?.attribute).toBe(
      'userName',
    )
  })
  it('means no filter when there is none', () => {
    expect(parseFilter(null, ['userName'])).toBeNull()
    expect(parseFilter('  ', ['userName'])).toBeNull()
  })
  it('says so about a filter it cannot answer', () => {
    expect(() => parseFilter('userName co "a"', ['userName'])).toThrow(
      ScimError,
    )
    expect(() => parseFilter('title eq "a"', ['userName'])).toThrow(/one of/)
  })
})

describe('paging', () => {
  it('starts at 1 and caps a page', () => {
    expect(parsePaging(new URLSearchParams())).toEqual({ start: 1, count: 100 })
    expect(parsePaging(new URLSearchParams('startIndex=0&count=5000'))).toEqual(
      { start: 1, count: 100 },
    )
    expect(parsePaging(new URLSearchParams('count=0')).count).toBe(0)
    expect(() => parsePaging(new URLSearchParams('count=x'))).toThrow(ScimError)
  })
})

describe('reading a user', () => {
  it('takes the primary email and a name from its parts', () => {
    expect(
      readUser({
        userName: 'ada',
        externalId: 'e1',
        name: { givenName: 'Ada', familyName: 'Lovelace' },
        emails: [
          { value: 'other@lab.org', primary: false },
          { value: 'ada@lab.org', primary: true },
        ],
        active: 'False',
      }),
    ).toEqual({
      userName: 'ada',
      externalId: 'e1',
      displayName: 'Ada Lovelace',
      email: 'ada@lab.org',
      active: false,
    })
  })
  it('refuses something that is not a user', () => {
    expect(() => readUser([])).toThrow(ScimError)
  })
})

describe('patching a user', () => {
  it('reads Okta (no path, value object)', () => {
    expect(
      userChangesFromPatch({
        Operations: [{ op: 'replace', value: { active: false } }],
      }),
    ).toEqual({ active: false })
  })
  it('reads Entra ID (capitalised op, string booleans, paths)', () => {
    expect(
      userChangesFromPatch({
        Operations: [
          { op: 'Replace', path: 'active', value: 'True' },
          { op: 'Replace', path: 'displayName', value: 'Ada L' },
          { op: 'Replace', path: 'userName', value: 'ada@lab.org' },
          {
            op: 'Replace',
            path: 'emails[type eq "work"].value',
            value: 'ada@lab.org',
          },
          {
            op: 'Add',
            path: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department',
            value: 'x',
          },
        ],
      }),
    ).toEqual({
      active: true,
      displayName: 'Ada L',
      userName: 'ada@lab.org',
      email: 'ada@lab.org',
    })
  })
  it('clears an external id on remove, and treats removing active as off', () => {
    expect(
      userChangesFromPatch({
        Operations: [
          { op: 'remove', path: 'externalId' },
          { op: 'remove', path: 'active' },
        ],
      }),
    ).toEqual({ externalId: null, active: false })
  })
  it('needs operations and a path to remove', () => {
    expect(() => userChangesFromPatch({})).toThrow(ScimError)
    expect(() =>
      userChangesFromPatch({ Operations: [{ op: 'remove' }] }),
    ).toThrow(/path/)
    expect(() =>
      userChangesFromPatch({
        Operations: [{ op: 'replace', path: 'active', value: 'maybe' }],
      }),
    ).toThrow(/true or false/)
  })
})

describe('groups', () => {
  it('reads members by value', () => {
    expect(
      readGroup({
        displayName: 'Admins',
        members: [{ value: 'a' }, { value: 'b' }],
      }),
    ).toEqual({ displayName: 'Admins', members: ['a', 'b'] })
  })
  it('adds, removes and replaces members', () => {
    const add = groupChangesFromPatch(
      { Operations: [{ op: 'add', path: 'members', value: [{ value: 'c' }] }] },
      ['a', 'b'],
    )

    expect(add.members).toEqual(['a', 'b', 'c'])

    const removeOne = groupChangesFromPatch(
      { Operations: [{ op: 'remove', path: 'members[value eq "a"]' }] },
      ['a', 'b'],
    )

    expect(removeOne.members).toEqual(['b'])

    const removeAll = groupChangesFromPatch(
      { Operations: [{ op: 'remove', path: 'members' }] },
      ['a', 'b'],
    )

    expect(removeAll.members).toEqual([])

    const replace = groupChangesFromPatch(
      {
        Operations: [
          { op: 'replace', path: 'members', value: [{ value: 'z' }] },
        ],
      },
      ['a'],
    )

    expect(replace.members).toEqual(['z'])
  })
  it('renames without touching members', () => {
    const renamed = groupChangesFromPatch(
      {
        Operations: [{ op: 'replace', path: 'displayName', value: 'Chemists' }],
      },
      ['a'],
    )

    expect(renamed).toEqual({ displayName: 'Chemists' })
  })
})

describe('shaping a user', () => {
  it('sends the SCIM shape with links', () => {
    const scimUser = toScimUser(
      {
        id: 'u1',
        user_name: 'ada@lab.org',
        external_id: null,
        email: 'ada@lab.org',
        display_name: 'Ada Lovelace',
        active: true,
        role: 'viewer',
        created: '2026-11-06T00:00:00Z',
        updated: '2026-11-06T00:00:00Z',
        groups: [{ value: 'g1', display: 'Admins' }],
      },
      'https://eln.test/api/scim/v2',
    )

    expect(scimUser.meta.location).toBe('https://eln.test/api/scim/v2/Users/u1')
    expect(scimUser.name).toMatchObject({
      givenName: 'Ada',
      familyName: 'Lovelace',
    })
    expect(scimUser.groups[0].$ref).toBe(
      'https://eln.test/api/scim/v2/Groups/g1',
    )
  })
})
