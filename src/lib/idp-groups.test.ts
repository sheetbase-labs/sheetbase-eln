import { describe, expect, it } from 'vitest'

import { groupsFromProfile, holdGroups, takeGroups } from './idp-groups'

describe('groupsFromProfile', () => {
  it('reads a list of groups and drops blanks', () => {
    expect(
      groupsFromProfile({ groups: ['Lab Admins', ' Scientists ', ''] }),
    ).toEqual(['Lab Admins', 'Scientists'])
  })

  it('reads a comma-separated string', () => {
    expect(groupsFromProfile({ groups: 'a, b ,c' })).toEqual(['a', 'b', 'c'])
  })

  it('reads the claim the install names', () => {
    expect(groupsFromProfile({ roles: ['x'] }, 'roles')).toEqual(['x'])
    expect(groupsFromProfile({ roles: ['x'] })).toBeNull()
  })

  it('tells a missing claim from an empty one', () => {
    expect(groupsFromProfile({ email: 'a@b.c' })).toBeNull()
    expect(groupsFromProfile({ groups: null })).toBeNull()
    expect(groupsFromProfile({ groups: [] })).toEqual([])
  })

  it('ignores entries that are not text', () => {
    expect(groupsFromProfile({ groups: ['a', 3, { name: 'b' }] })).toEqual([
      'a',
    ])
  })
})

describe('held groups', () => {
  it('hands the groups to the step that knows who signed in, once', () => {
    holdGroups('Person@Lab.test', ['g'])
    expect(takeGroups('person@lab.test')).toEqual(['g'])
    expect(takeGroups('person@lab.test')).toBeNull()
  })

  it('lets them lapse', () => {
    holdGroups('late@lab.test', ['g'], 1_000)
    expect(takeGroups('late@lab.test', 1_000 + 3 * 60 * 1000)).toBeNull()
  })
})
