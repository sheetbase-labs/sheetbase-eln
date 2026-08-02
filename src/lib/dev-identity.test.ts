import { describe, expect, it } from 'vitest'

import {
  DEFAULT_DEV_USER_EMAIL,
  DEFAULT_DEV_USER_ID,
  devUserEmail,
  resolveDevUserId,
  resolveDevUserIdentity,
} from './dev-identity'

describe('auth-free development identity', () => {
  it('keeps the default identity stable', () => {
    expect(resolveDevUserId()).toBe(DEFAULT_DEV_USER_ID)
    expect(devUserEmail(DEFAULT_DEV_USER_ID)).toBe(DEFAULT_DEV_USER_EMAIL)
    expect(resolveDevUserIdentity()).toEqual({
      id: DEFAULT_DEV_USER_ID,
      name: 'Fixture Owner',
      email: DEFAULT_DEV_USER_EMAIL,
    })
  })

  it('derives the seed email from a configured ID without changing the ID', () => {
    const configuredId = '00000000-0000-4000-8000-000000000099'

    expect(resolveDevUserId(` ${configuredId} `)).toBe(configuredId)
    expect(devUserEmail(configuredId)).toBe('owner+000000000000@sheetbase.test')
    expect(resolveDevUserIdentity(configuredId)).toMatchObject({
      id: configuredId,
      email: 'owner+000000000000@sheetbase.test',
    })
  })
})
